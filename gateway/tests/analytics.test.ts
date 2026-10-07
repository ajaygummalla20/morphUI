import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { test, type TestContext } from "node:test";
import { GATEWAY_PROTOCOL_VERSION, type GatewayExecuteRequest } from "../../lib/gateway/contract.js";
import type { GatewayConfig } from "../src/config.js";
import { gatewayPolicySchema, type GatewayPolicy } from "../src/policy.js";
import { createGatewayServer } from "../src/server.js";

const token = "test-analytics-service-token-123456";
const config: GatewayConfig = {
  port: 8788, databaseUrl: "postgresql://unused.example/test", serviceToken: token,
  policyPath: "config/policy.example.json", gatewayId: "test-analytics-gateway",
  auditHashSalt: "test-analytics-audit-salt-123456",
  identity: {
    issuer: "https://identity.atlas.example", audience: "morph-gateway",
    jwksUrl: "https://identity.atlas.example/.well-known/jwks.json",
    maximumTokenAgeSeconds: 300, clockToleranceSeconds: 30, jwksCacheSeconds: 300,
  },
};
const rawPolicy = JSON.parse(await readFile("config/policy.example.json", "utf8"));
const aggregateRows = [
  { bucket: "2026-01-01", group: null, value: 25000, record_count: 250 },
  { bucket: "2026-02-01", group: null, value: 60000, record_count: 300 },
];

function requestPlan(): GatewayExecuteRequest {
  return {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    requestId: crypto.randomUUID(), connectorId: "connector_production_postgresql",
    identity: { organizationId: "org_atlas_insurance", assertion: "test-analytics-identity-assertion-long-enough-for-contract" },
    plan: {
      operation: "select", entity: "policies", source: "policies_read_replica",
      catalogVersion: "insurance-catalog-2026-09-01",
      fields: ["start_date", "total_premium"], filters: [], orderBy: [], rowLimit: 12,
      analysis: {
        metricId: "written_premium",
        time: { field: "start_date", grain: "month", start: "2026-01-01", end: "2026-02-28" },
        comparison: "previous_bucket",
      },
    },
  };
}

async function startService(context: TestContext, policy: GatewayPolicy, rows: Record<string, unknown>[]) {
  let executions = 0;
  const server = createGatewayServer({
    config, policy,
    execute: async () => { executions++; return rows; },
    verifyIdentity: async () => ({
      organizationId: policy.organizationId, subjectId: "private-employee-subject",
      email: "kiran@atlas.example", identityProvider: "oidc",
      issuer: config.identity.issuer, expiresAt: new Date(Date.now() + 300000).toISOString(),
      jti: crypto.randomUUID(),
    }),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const port = (server.address() as AddressInfo).port;
  return {
    executions: () => executions,
    send: (request: GatewayExecuteRequest) => fetch(`http://127.0.0.1:${port}/v1/query-plans/execute`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }),
  };
}

test("HTTP analytics return approved virtual rows with all-matching-records scope", async (t) => {
  const service = await startService(t, gatewayPolicySchema.parse(rawPolicy), aggregateRows);
  const response = await service.send(requestPlan());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.decision, "allow");
  assert.equal(result.resultScope, "all_matching_records");
  assert.deepEqual(result.rows, aggregateRows);
  assert.deepEqual(result.maskedFields, []);
  assert.equal(result.returnedRows, 2);
  assert.equal(service.executions(), 1);
});

test("omitting client aggregate metric approval denies analytics before execution", async (t) => {
  const unapproved = structuredClone(rawPolicy);
  delete unapproved.entities.policies.aggregateMetricIds;
  const service = await startService(t, gatewayPolicySchema.parse(unapproved), aggregateRows);
  const response = await service.send(requestPlan());
  assert.equal(response.status, 403);
  const result = await response.json();
  assert.equal(result.decision, "deny");
  assert.equal(service.executions(), 0);
  assert.equal("rows" in result, false);
});

for (const [label, field] of [["measure", "total_premium"], ["date", "start_date"], ["group", "branch"]] as const) {
  test(`client-masked analytic ${label} is denied before database execution`, async (t) => {
    const policy = gatewayPolicySchema.parse(rawPolicy);
    policy.masking[field] = "redact";
    const request = requestPlan();
    if (label === "group") { request.plan.groupBy = "branch"; request.plan.fields.push("branch"); }
    const service = await startService(t, policy, aggregateRows);
    const response = await service.send(request);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).decision, "deny");
    assert.equal(service.executions(), 0);
  });
}

test("lookahead overflow denies the entire aggregate and audits no records or raw identity", async (t) => {
  const logs: string[] = [];
  t.mock.method(console, "log", (message: unknown) => { logs.push(String(message)); });
  const service = await startService(t, gatewayPolicySchema.parse(rawPolicy), aggregateRows);
  const request = requestPlan();
  request.plan.rowLimit = 1;
  const response = await service.send(request);
  assert.equal(response.status, 403);
  const denial = await response.json();
  assert.equal(denial.decision, "deny");
  assert.equal(denial.reasonCode, "row_limit_exceeded");
  assert.equal("rows" in denial, false);
  assert.equal(service.executions(), 1);
  const event = logs.map((line) => JSON.parse(line)).find((event) => event.type === "morph_gateway_audit");
  assert.ok(event);
  assert.equal(event.decision, "deny");
  assert.equal(event.reasonCode, "row_limit_exceeded");
  assert.equal(event.requestId, request.requestId);
  assert.match(event.subjectHash, /^[a-f0-9]{24}$/);
  for (const forbidden of ["subjectId", "email", "rows", "values", "assertion", "query", "prompt"]) {
    assert.equal(forbidden in event, false, `${forbidden} must not be logged`);
  }
  assert.doesNotMatch(logs.join("\n"), /private-employee-subject|kiran@atlas\.example|60000|25000|test-analytics-identity-assertion/);
});

for (const invalidRows of [
  [{ ...aggregateRows[0], value: "25000" }],
  [{ ...aggregateRows[0], customer_name: "Unapproved confidential name" }],
]) {
  test("invalid analytic virtual rows fail closed without partial records", async (t) => {
    const service = await startService(t, gatewayPolicySchema.parse(rawPolicy), invalidRows);
    const response = await service.send(requestPlan());
    assert.equal(response.status, 500, "invalid server results are execution failures, not invalid client requests");
    const result = await response.json();
    assert.equal("rows" in result, false);
    assert.doesNotMatch(JSON.stringify(result), /Unapproved confidential name|25000/);
  });
}
