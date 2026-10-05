import assert from "node:assert/strict";
import test from "node:test";
import type { GatewayQueryPlan } from "../../lib/gateway/contract.js";
import { compileCatalogProbe, compileQuery } from "../src/compiler.js";

test("the compiler uses only catalog SQL and parameterized values", () => {
  const plan: GatewayQueryPlan = {
    source: "policies_read_replica",
    catalogVersion: "insurance-catalog-2026-09-01",
    operation: "select",
    entity: "policies",
    fields: ["policy_number", "customer_name", "total_premium", "status"],
    filters: [
      {
        field: "status",
        operator: "equals",
        value: "active'; DROP TABLE policies; --",
      },
      {
        field: "total_premium",
        operator: "greater_than",
        value: 20_000,
      },
    ],
    orderBy: [],
    rowLimit: 50,
  };

  const query = compileQuery(plan);
  assert.doesNotMatch(query.text, /DROP TABLE/i);
  assert.match(query.text, /p\.status::text = \$1/);
  assert.match(query.text, /p\.total_premium > \$2/);
  assert.match(query.text, /LIMIT \$3/);
  assert.deepEqual(query.values, [
    "active'; DROP TABLE policies; --",
    20_000,
    50,
  ]);
});

test("the compiler rejects fields outside its hard-coded catalog", () => {
  const plan = {
    source: "claims_read_replica",
    operation: "select",
    entity: "claims",
    fields: ["credit_card_number"],
    filters: [],
    catalogVersion: "insurance-catalog-2026-09-01",
    orderBy: [],
    rowLimit: 20,
  } as GatewayQueryPlan;
  assert.throws(() => compileQuery(plan), /Unknown selected field/);
});

test("catalog discovery probes approved joins without returning customer rows", () => {
  const probe = compileCatalogProbe({
    entity: "claims",
    source: "claims_read_replica",
    fields: ["claim_number", "customer_name", "claimed_amount"],
  });
  assert.match(probe.text, /FROM claims cl/);
  assert.match(probe.text, /LIMIT 0$/);
  assert.deepEqual(probe.values, []);
});
