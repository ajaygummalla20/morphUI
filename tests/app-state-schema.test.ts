import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const expectedTables = [
  "access_rules",
  "app_users",
  "audit_events",
  "auth_flows",
  "auth_sessions",
  "catalog_entities",
  "catalog_fields",
  "catalog_metrics",
  "catalog_relationships",
  "catalog_snapshots",
  "connector_permissions",
  "data_connectors",
  "organizations",
  "request_limits",
  "saved_workspaces",
  "user_preferences",
  "workspace_runs",
];

test("app-state migrations create a relational, constrained persistence model", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");

  const migrations = readdirSync("drizzle")
    .filter((file) => file.endsWith(".sql"))
    .sort();
  assert.ok(migrations.length > 0, "at least one D1 migration is required");

  for (const migration of migrations) {
    const sql = readFileSync(join("drizzle", migration), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      if (statement.trim()) db.exec(statement);
    }
  }

  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String(row.name));
  assert.deepEqual(tables, expectedTables);

  db.exec(`
    INSERT INTO organizations (id, slug, name) VALUES ('org_1', 'atlas', 'Atlas');
    INSERT INTO app_users (id, organization_id, email, full_name)
      VALUES ('user_1', 'org_1', 'admin@atlas.example', 'Atlas Admin');
    INSERT INTO user_preferences (user_id, email_safety_alerts)
      VALUES ('user_1', 1);
    INSERT INTO data_connectors (
      id, organization_id, created_by_user_id, name, engine,
      private_host, database_name, region, status
    ) VALUES (
      'connector_1', 'org_1', 'user_1', 'Production PostgreSQL',
      'PostgreSQL', 'private-network', 'insurance_ops', 'Mumbai', 'healthy'
    );
    INSERT INTO connector_permissions (id, connector_id, table_name)
      VALUES ('permission_1', 'connector_1', 'policies');
    INSERT INTO catalog_snapshots (
      id, connector_id, catalog_version, policy_version, entity_count, field_count
    ) VALUES ('snapshot_1', 'connector_1', 'catalog_v1', 'policy_v1', 1, 1);
    INSERT INTO catalog_entities (
      id, snapshot_id, entity_name, label, description, source_name,
      primary_key, maximum_rows
    ) VALUES (
      'entity_1', 'snapshot_1', 'policies', 'Policies', 'Approved policies',
      'policies_read_replica', 'policy_number', 200
    );
    INSERT INTO catalog_fields (
      id, catalog_entity_id, field_name, label, description, data_type,
      semantic_type, display_format, sensitivity
    ) VALUES (
      'field_1', 'entity_1', 'policy_number', 'Policy', 'Policy identifier',
      'string', 'identifier', 'id', 'internal'
    );
    INSERT INTO catalog_metrics (
      id, catalog_entity_id, metric_name, label, description, operation, display_format
    ) VALUES (
      'metric_1', 'entity_1', 'policy_count', 'Policies', 'Count of policies',
      'count', 'number'
    );
    INSERT INTO access_rules (
      id, organization_id, name, dataset_scope, permitted_field_count,
      team_name, created_by_user_id
    ) VALUES (
      'rule_1', 'org_1', 'Policy operations', 'motor_policies', 8,
      'Operations team', 'user_1'
    );
    INSERT INTO saved_workspaces (
      id, organization_id, owner_user_id, title, prompt, workspace_json
    ) VALUES (
      'workspace_1', 'org_1', 'user_1', 'Renewals',
      'Show upcoming motor policy renewals', '{}'
    );
    INSERT INTO workspace_runs (
      id, organization_id, user_id, saved_workspace_id, prompt, status
    ) VALUES (
      'run_1', 'org_1', 'user_1', 'workspace_1',
      'Show upcoming motor policy renewals', 'succeeded'
    );
    INSERT INTO audit_events (
      id, organization_id, actor_user_id, actor_label, action,
      target, outcome, request_id
    ) VALUES (
      'audit_1', 'org_1', 'user_1', 'Atlas Admin', 'Workspace generated',
      'Renewals', 'success', 'req_1'
    );
  `);

  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM saved_workspaces").get()?.count,
    1,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM catalog_fields").get()?.count,
    1,
  );
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO app_users (id, organization_id, email, full_name) VALUES ('user_2', 'org_1', 'admin@atlas.example', 'Duplicate')",
      ),
    /UNIQUE constraint failed/,
  );
  assert.throws(
    () =>
      db.exec(
        "INSERT INTO connector_permissions (id, connector_id, table_name) VALUES ('permission_2', 'missing', 'claims')",
      ),
    /FOREIGN KEY constraint failed/,
  );
});
