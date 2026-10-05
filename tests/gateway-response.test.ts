import assert from "node:assert/strict";
import test from "node:test";
import { executeWorkspaceGateway, GatewayProtocolError } from "../lib/gateway/client";
import { executeSecureDemoGateway } from "../lib/gateway/secure-demo";
import { createWorkspaceQueryPlan, planWorkspaceRequest } from "../lib/workspaces/dynamic";
import { insuranceSemanticCatalog } from "../lib/catalog/semantic";
import type { GatewayAllowResponse } from "../lib/gateway/contract";

test("remote responses must match the request, identity, fields and row bounds", async (t) => {
  const plan = planWorkspaceRequest("Show pending endorsements in a table only");
  const queryPlan = { ...createWorkspaceQueryPlan(plan), fields: ["endorsement_number", "status"], rowLimit: 2 };
  const originalFetch = globalThis.fetch;
  const previousUrl = process.env.MORPH_GATEWAY_URL;
  process.env.MORPH_GATEWAY_URL = "https://gateway.example";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.MORPH_GATEWAY_URL;
    else process.env.MORPH_GATEWAY_URL = previousUrl;
  });
  let mutate: (response: GatewayAllowResponse) => void = () => {};
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const response = executeSecureDemoGateway(request, plan);
    assert.equal(response.decision, "allow");
    if (response.decision !== "allow") throw new Error("Fixture denied");
    response.identityProvider = "oidc";
    // The real service reports its policy ceiling, not the requested page size.
    response.maximumRows = 200;
    mutate(response);
    return Response.json(response);
  };
  const execute = () => executeWorkspaceGateway({
    plan, queryPlan, catalogEntity: insuranceSemanticCatalog.entities.find((entity) => entity.entity === "endorsements")!,
    identity: { organizationId: "org_atlas_insurance", assertion: "a".repeat(40) },
  });
  assert.equal((await execute()).records.length, 2);
  const invalid: Array<[string, (response: GatewayAllowResponse) => void]> = [
    ["request ID", (r) => { r.requestId = crypto.randomUUID(); }],
    ["connector", (r) => { r.connectorId = "another_connector"; }],
    ["identity", (r) => { r.identityVerified = false; }],
    ["demo identity", (r) => { r.identityProvider = "secure_demo"; }],
    ["different plan", (r) => { r.executedPlan.filters = []; }],
    ["catalog version", (r) => { r.catalogVersion = "stale"; }],
    ["extra field", (r) => { r.rows[0].customer_name = "Sensitive name"; }],
    ["missing field", (r) => { delete r.rows[0].status; }],
    ["row count", (r) => { r.returnedRows = 0; }],
    ["row limit", (r) => { r.rows.push(r.rows[0]); r.returnedRows = 3; }],
    ["policy row ceiling", (r) => { r.maximumRows = 1; }],
  ];
  for (const [name, change] of invalid) {
    mutate = change;
    await assert.rejects(execute, GatewayProtocolError, name);
  }
});
