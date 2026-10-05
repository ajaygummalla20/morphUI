import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceQueryPlan,
  planWorkspaceRequest,
} from "../lib/workspaces/dynamic";
import {
  createDemoGatewayRequestForTests,
  executeSecureDemoGateway,
} from "../lib/gateway/secure-demo";
import { gatewayExecuteRequestSchema } from "../lib/gateway/contract";

test("pending endorsements are filtered before sorting, limiting and projection", () => {
  const plan = planWorkspaceRequest("Show pending endorsements grouped by type. Table only");
  const decision = executeSecureDemoGateway(createDemoGatewayRequestForTests({ plan: {
    ...createWorkspaceQueryPlan(plan),
    fields: ["endorsement_number", "status"],
    orderBy: [{ field: "endorsement_number", direction: "desc" }],
    rowLimit: 2,
  } }), plan);
  assert.equal(decision.decision, "allow");
  if (decision.decision !== "allow") return;
  assert.deepEqual(decision.rows, [
    { endorsement_number: "END-DEMO-0015", status: "under_review" },
    { endorsement_number: "END-DEMO-0014", status: "documents_pending" },
  ]);
  assert.equal(decision.returnedRows, 2);
  assert.deepEqual(decision.maskedFields, []);
});

test("renewal filtering precedes limiting and returns every selected policy field", () => {
  const plan = planWorkspaceRequest("Show motor policies expiring in the next 15 days above ₹20,000");
  const decision = executeSecureDemoGateway(createDemoGatewayRequestForTests({ plan: {
    ...createWorkspaceQueryPlan(plan),
    fields: ["policy_number", "total_premium", "product", "status"],
    filters: [...plan.filters, { field: "total_premium", operator: "less_than", value: 30000 }],
    orderBy: [{ field: "total_premium", direction: "asc" }],
    rowLimit: 1,
  } }), { ...plan, limit: 1 });
  assert.equal(decision.decision, "allow");
  if (decision.decision !== "allow") return;
  assert.equal(decision.rows.length, 1);
  assert.equal(decision.rows[0].total_premium, 22750);
  assert.equal(typeof decision.rows[0].product, "string");
  assert.equal(decision.rows[0].status, "active");
});

test("the client Gateway policy allows only group-authorized entities", () => {
  const plan = planWorkspaceRequest(
    "Show high-value claims reported this month by branch",
  );
  const queryPlan = createWorkspaceQueryPlan(plan);

  const allowed = executeSecureDemoGateway(
    createDemoGatewayRequestForTests({
      plan: queryPlan,
    }),
    plan,
    ["Claims managers"],
  );
  assert.equal(allowed.decision, "allow");

  const denied = executeSecureDemoGateway(
    createDemoGatewayRequestForTests({
      plan: queryPlan,
    }),
    plan,
    ["Operations team"],
  );
  assert.equal(denied.decision, "deny");
  if (denied.decision === "deny") {
    assert.equal(denied.reasonCode, "entity_not_allowed");
    assert.match(denied.reason, /client policy/i);
  }
});

test("the Gateway rejects fields outside policy before data execution", () => {
  const plan = planWorkspaceRequest("Show the active policy portfolio by product");
  const queryPlan = createWorkspaceQueryPlan(plan);
  const decision = executeSecureDemoGateway(
    createDemoGatewayRequestForTests({
      plan: {
        ...queryPlan,
        fields: [...queryPlan.fields, "bank_account_number"],
      },
    }),
    plan,
  );

  assert.equal(decision.decision, "deny");
  if (decision.decision === "deny") {
    assert.equal(decision.reasonCode, "field_not_allowed");
  }
});

test("the Gateway masks sensitive result fields and returns audit identifiers", () => {
  const plan = planWorkspaceRequest(
    "Show motor policies expiring in the next 15 days above ₹20,000",
  );
  const decision = executeSecureDemoGateway(
    createDemoGatewayRequestForTests({
      plan: createWorkspaceQueryPlan(plan),
    }),
    plan,
  );

  assert.equal(decision.decision, "allow");
  if (decision.decision === "allow") {
    assert.match(decision.decisionId, /^decision_/);
    assert.ok(decision.policyVersion.length > 0);
    assert.deepEqual(decision.maskedFields, ["customer_name"]);
    assert.ok(
      decision.rows.every((row) =>
        String(row.customer_name).includes("•••••• customer"),
      ),
    );
  }
});

test("the strict Gateway contract blocks oversized row requests", () => {
  const plan = planWorkspaceRequest("Show the active policy portfolio by product");
  const request = createDemoGatewayRequestForTests({
    plan: { ...createWorkspaceQueryPlan(plan), rowLimit: 201 },
  });
  assert.throws(() => gatewayExecuteRequestSchema.parse(request));
});

test("the Gateway rejects stale catalogues and unapproved sorting", () => {
  const plan = planWorkspaceRequest("Show the active policy portfolio by product");
  const queryPlan = createWorkspaceQueryPlan(plan);
  const stale = executeSecureDemoGateway(
    createDemoGatewayRequestForTests({
      plan: { ...queryPlan, catalogVersion: "insurance-catalog-stale" },
    }),
    plan,
  );
  assert.equal(stale.decision, "deny");
  if (stale.decision === "deny") {
    assert.equal(stale.reasonCode, "catalog_version_mismatch");
  }

  const unapprovedSort = executeSecureDemoGateway(
    createDemoGatewayRequestForTests({
      plan: {
        ...queryPlan,
        orderBy: [{ field: "bank_account_number", direction: "desc" }],
      },
    }),
    plan,
  );
  assert.equal(unapprovedSort.decision, "deny");
  if (unapprovedSort.decision === "deny") {
    assert.equal(unapprovedSort.reasonCode, "sort_not_allowed");
  }
});
