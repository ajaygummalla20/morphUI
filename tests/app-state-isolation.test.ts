import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
import test, { type TestContext } from "node:test";
import { insuranceSemanticCatalog } from "../lib/catalog/semantic";
import type { AppActor } from "../db/app-state";
import type { DynamicWorkspaceResponse } from "../lib/workspaces/dynamic";
import { createSqliteD1 } from "./helpers/sqlite-d1";

register("./helpers/cloudflare-env-loader.mjs", import.meta.url);
const { env } = await import("cloudflare:workers");
const { activateConnector, loadAppState, saveWorkspace, updateWorkspace } = await import("../db/app-state");

const actor: AppActor = {
  id: "user_a", organizationId: "org_a", email: "admin@tenant-a.example",
  fullName: "Tenant A Admin", role: "admin",
};
const ownConnectorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreignConnectorId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function fixture(t: TestContext) {
  const database = createSqliteD1();
  const bindings = env as unknown as { DB?: typeof database.d1 };
  const previous = bindings.DB;
  bindings.DB = database.d1;
  t.after(() => {
    if (previous === undefined) delete bindings.DB;
    else bindings.DB = previous;
    database.close();
  });
  const directory = new URL("../drizzle/", import.meta.url);
  for (const name of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
    database.sqlite.exec(readFileSync(new URL(name, directory), "utf8"));
  }
  database.sqlite.exec(`
    INSERT INTO organizations (id, slug, name) VALUES
      ('org_a', 'tenant-a', 'Tenant A'), ('org_b', 'tenant-b', 'Tenant B');
    INSERT INTO app_users (id, organization_id, email, full_name, role) VALUES
      ('user_a', 'org_a', 'admin@tenant-a.example', 'Tenant A Admin', 'admin'),
      ('user_b', 'org_b', 'admin@tenant-b.example', 'Tenant B Admin', 'admin');
  `);
  return database;
}

function seedConnector(database: ReturnType<typeof createSqliteD1>, id: string, tenant: "a" | "b", status = "healthy") {
  database.sqlite.prepare(`INSERT INTO data_connectors
    (id, organization_id, created_by_user_id, name, engine, private_host, database_name, region, status)
    VALUES (?, ?, ?, ?, 'PostgreSQL', 'original-private-host', 'original_database', 'Mumbai', ?)`)
    .run(id, `org_${tenant}`, `user_${tenant}`, `Tenant ${tenant} connector`, status);
}

function activation(id: string) {
  return {
    connector: {
      id, name: "Updated connector", engine: "PostgreSQL" as const,
      host: "replacement-private-host", databaseName: "replacement_database", region: "Mumbai",
      status: "healthy" as const, lastCheckedAt: "2026-10-01T00:00:00.000Z",
    },
    catalog: insuranceSemanticCatalog,
    selectedEntities: ["policies"],
    policyVersion: "replacement-policy",
  };
}

function snapshot(database: ReturnType<typeof createSqliteD1>) {
  const tables = ["data_connectors", "connector_permissions", "catalog_snapshots", "catalog_entities", "catalog_fields", "catalog_metrics", "catalog_relationships"];
  return Object.fromEntries(tables.map((table) => [
    table, database.sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
  ]));
}

test("activating another tenant's connector rejects without modifying its connector, permissions or catalog", async (t) => {
  const database = fixture(t);
  seedConnector(database, foreignConnectorId, "b");
  database.sqlite.prepare(`INSERT INTO connector_permissions
    (id, connector_id, table_name, allowed_fields_json, enabled) VALUES ('foreign_permission', ?, 'claims', '["claim_number"]', 1)`)
    .run(foreignConnectorId);
  database.sqlite.prepare(`INSERT INTO catalog_snapshots
    (id, connector_id, catalog_version, policy_version, entity_count, field_count)
    VALUES ('foreign_snapshot', ?, 'original-catalog', 'original-policy', 1, 1)`)
    .run(foreignConnectorId);
  const before = snapshot(database);

  await assert.rejects(() => activateConnector(actor, activation(foreignConnectorId)));

  assert.deepEqual(snapshot(database), before, "a denied activation must preserve all existing connector state");
});

test("an administrator can still activate a connector owned by their tenant", async (t) => {
  const database = fixture(t);
  seedConnector(database, ownConnectorId, "a");

  await activateConnector(actor, activation(ownConnectorId));

  assert.equal(database.sqlite.prepare("SELECT organization_id FROM data_connectors WHERE id = ?").get(ownConnectorId)?.organization_id, "org_a");
  assert.equal(database.sqlite.prepare("SELECT name FROM data_connectors WHERE id = ?").get(ownConnectorId)?.name, "Updated connector");
  assert.deepEqual((await loadAppState(actor)).approvedTables, ["policies"]);
});

test("a tenant without a healthy connector receives no other tenant's default permissions", async (t) => {
  const database = fixture(t);
  seedConnector(database, "connector_production_postgresql", "b");
  seedConnector(database, ownConnectorId, "a", "unavailable");
  database.sqlite.exec(`INSERT INTO connector_permissions
    (id, connector_id, table_name, enabled)
    VALUES ('other_tenant_default', 'connector_production_postgresql', 'claims', 1)`);

  const state = await loadAppState(actor);

  assert.deepEqual(state.approvedTables, []);
  assert.deepEqual(state.connectors.map((connector) => connector.id), [ownConnectorId]);
});

test("bootstrap returns only enabled permissions belonging to its tenant's active connector", async (t) => {
  const database = fixture(t);
  seedConnector(database, ownConnectorId, "a");
  seedConnector(database, foreignConnectorId, "b");
  const insert = database.sqlite.prepare(`INSERT INTO connector_permissions
    (id, connector_id, table_name, enabled) VALUES (?, ?, ?, ?)`);
  insert.run("own_allowed", ownConnectorId, "policies", 1);
  insert.run("own_disabled", ownConnectorId, "endorsements", 0);
  insert.run("foreign_allowed", foreignConnectorId, "claims", 1);

  const state = await loadAppState(actor);

  assert.equal(state.organization.id, actor.organizationId);
  assert.deepEqual(state.approvedTables, ["policies"]);
  assert.deepEqual(state.connectors.map((connector) => connector.id), [ownConnectorId]);
});

test("workspace saves discard query results, including legacy caches on an updated definition", async (t) => {
  const database = fixture(t);
  const definition = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    title: "Policy review", prompt: "Show policies", savedAt: new Date().toISOString(), pinned: false,
    data: { intent: "policies", sourceMode: "gateway", table: { rows: [{ customer: "private customer" }] }, metrics: [{ value: 123 }] } as unknown as DynamicWorkspaceResponse,
  };
  await saveWorkspace(actor, definition);
  const row = () => database.sqlite.prepare("SELECT workspace_json FROM saved_workspaces WHERE id = ?").get(definition.id);
  assert.equal(row()?.workspace_json, null);
  database.sqlite.prepare("UPDATE saved_workspaces SET workspace_json = ? WHERE id = ?").run('{"metrics":[123]}', definition.id);
  await saveWorkspace(actor, definition);
  assert.equal(row()?.workspace_json, null);
  assert.equal((await loadAppState(actor)).savedWorkspaces[0].data, null);
});

test("shared definitions stay within their organization and only their owner can mutate them", async (t) => {
  const database = fixture(t);
  database.sqlite.exec("INSERT INTO app_users (id, organization_id, email, full_name, role) VALUES ('peer_a', 'org_a', 'peer@tenant-a.example', 'Peer A', 'member')");
  const peer: AppActor = { ...actor, id: "peer_a", email: "peer@tenant-a.example", role: "member" };
  const foreign: AppActor = { ...actor, id: "user_b", organizationId: "org_b", email: "admin@tenant-b.example" };
  const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await saveWorkspace(actor, { id, title: "Team policies", prompt: "Show policies", savedAt: new Date().toISOString(), pinned: false, data: null });
  assert.equal((await loadAppState(peer)).savedWorkspaces.length, 0);
  await updateWorkspace(actor, id, { shared: true });
  assert.equal((await loadAppState(peer)).savedWorkspaces[0].canEdit, false);
  assert.equal((await loadAppState(foreign)).savedWorkspaces.length, 0);
  await assert.rejects(updateWorkspace(peer, id, { delete: true }));
  await assert.rejects(updateWorkspace(foreign, id, { title: "Foreign edit" }));
  await assert.rejects(updateWorkspace({ ...actor, role: "viewer" }, id, { pinned: true }));
  assert.equal((await loadAppState(actor)).savedWorkspaces[0].title, "Team policies");
});
