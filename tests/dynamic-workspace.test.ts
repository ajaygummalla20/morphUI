import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/workspaces/generate/route";
import {
  planWorkspaceRequest,
  UnsupportedWorkspaceRequestError,
} from "../lib/workspaces/dynamic";
import { planWorkspaceRequestWithAi } from "../lib/workspaces/ai-planner";
import { insuranceSemanticCatalog } from "../lib/catalog/semantic";

const prompts = [
  [
    "renewals",
    "Show motor policies expiring in the next 30 days above ₹50,000",
  ],
  ["claims", "Show high-value claims reported this month by branch"],
  ["endorsements", "Show pending endorsements grouped by type"],
  ["policies", "Show the active policy portfolio by product"],
] as const;

test("the planner recognizes every allowlisted insurance workspace", () => {
  for (const [intent, prompt] of prompts) {
    assert.equal(planWorkspaceRequest(prompt).intent, intent);
  }

  const plan = planWorkspaceRequest(prompts[0][1]);
  assert.equal(plan.days, 30);
  assert.equal(plan.minimumAmount, 50_000);
  assert.equal(plan.limit, 200);
});

test("unsupported requests receive guided suggestions", () => {
  assert.throws(
    () => planWorkspaceRequest("Plan an office lunch for tomorrow"),
    (error: unknown) =>
      error instanceof UnsupportedWorkspaceRequestError &&
      error.suggestions.length === 4,
  );
});

test("presentation instructions control the generated block types", async () => {
  const prompt =
    "Show pending endorsements grouped by type. Show in normal table only";
  const plan = planWorkspaceRequest(prompt);
  assert.equal(plan.presentation.mode, "table_only");
  assert.deepEqual(plan.presentation.blocks, ["table"]);
  assert.equal(plan.presentation.tableLayout, "grouped_summary");
  assert.equal(plan.groupBy, "type");
  assert.deepEqual(plan.filters, [
    {
      field: "status",
      operator: "in",
      value: "requested,documents_pending,under_review",
    },
  ]);

  const response = await POST(
    new Request("http://localhost/api/workspaces/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin:"http://localhost" },
      body: JSON.stringify({ prompt, limit: 200 }),
    }),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(
    payload.spec.blocks.map((block: { type: string }) => block.type),
    ["table"],
  );
  assert.equal(payload.presentation.mode, "table_only");
  assert.equal(payload.safety.returnedRows, 12);
  assert.equal(payload.spec.blocks[0].rows.reduce((total: number, row: { record_count: number }) => total + row.record_count, 0), 12);
  assert.ok(payload.spec.blocks[0].rows.every((row: { group: string }) => row.group !== "coverage_change"));
  assert.match(payload.spec.blocks[0].title, /grouped by type/i);
  assert.deepEqual(
    payload.spec.blocks[0].columns.map((column: { key: string }) => column.key),
    ["group", "record_count", "total_value", "average_value"],
  );

  const chartOnly = planWorkspaceRequest("Show claims by branch as a chart only");
  assert.deepEqual(chartOnly.presentation.blocks, ["chart"]);
  const donutOnly = planWorkspaceRequest("Display claims as a donut chart");
  assert.equal(donutOnly.visualization, "donut");
  assert.deepEqual(donutOnly.presentation.blocks, ["chart"]);
  const metricsOnly = planWorkspaceRequest("Show policy portfolio metrics only");
  assert.deepEqual(metricsOnly.presentation.blocks, ["metrics"]);
});

test("the AI planner can interpret new phrasing without adding prompt-specific code", async () => {
  const result = await planWorkspaceRequestWithAi(
    "Arrange unresolved policy amendments into a compact matrix with one row per change category and omit every visual",
    insuranceSemanticCatalog,
    200,
    {
      model: "test/model",
      generateProposal: async () => ({
        supported: true,
        intent: "endorsements",
        entity: "endorsements",
        analysis: { metricId: "endorsement_count", time: null, comparison: "none" },
        title: "Unresolved endorsements by type",
        interpretation: "Pending endorsements grouped by change type in a summary table",
        fields: ["type", "premium_delta"],
        filters: [
          {
            field: "status",
            operator: "in",
            value: "requested,documents_pending,under_review",
          },
        ],
        groupBy: "type",
        orderBy: [],
        metricIds: [],
        visualization: "table",
        presentation: {
          blocks: ["table"],
          tableLayout: "grouped_summary",
        },
        unsupportedReason: "",
      }),
    },
  );

  assert.equal(result.planner.mode, "ai");
  assert.equal(result.planner.validated, true);
  assert.equal(result.plan.title, "Unresolved endorsements by type");
  assert.deepEqual(result.plan.presentation.blocks, ["table"]);
  assert.equal(result.plan.presentation.tableLayout, "grouped_summary");
  assert.equal(result.plan.groupBy, "type");
});

test("an AI proposal cannot escape the approved semantic catalogue", async () => {
  const result = await planWorkspaceRequestWithAi(
    "Show pending endorsements grouped by type in a table",
    insuranceSemanticCatalog,
    200,
    {
      allowFallback: true,
      model: "test/model",
      generateProposal: async () => ({
        supported: true,
        intent: "endorsements",
        entity: "endorsements",
        title: "Unsafe proposal",
        interpretation: "Attempt to access an unapproved field",
        fields: ["bank_account_number"],
        filters: [],
        groupBy: null,
        orderBy: [],
        metricIds: [],
        visualization: "table",
        presentation: { blocks: ["table"], tableLayout: "records" },
        unsupportedReason: "",
      }),
    },
  );

  assert.equal(result.planner.mode, "deterministic_fallback");
  assert.equal(result.planner.reason, "ai_plan_rejected");
  assert.equal(result.plan.fields.includes("bank_account_number"), false);
});

test("the API returns a different validated UI specification per request", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;

  try {
    const results = await Promise.all(
      prompts.map(async ([intent, prompt]) => {
        const response = await POST(
          new Request("http://localhost/api/workspaces/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json", Origin:"http://localhost" },
            body: JSON.stringify({ prompt, limit: 200 }),
          }),
        );
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.equal(payload.intent, intent);
        assert.equal(payload.sourceMode, "secure_demo");
        assert.equal(payload.spec.blocks[0].type, "metrics");
        assert.ok(payload.spec.blocks.some((block: { type: string }) => block.type === "filters"));
        assert.ok(payload.spec.blocks.some((block: { type: string }) => block.type === "chart"));
        assert.equal(payload.spec.blocks.at(-1).type, "table");
        assert.equal(payload.queryPlan.operation, "select");
        assert.match(payload.queryPlan.catalogVersion, /^insurance-catalog-/);
        assert.equal(payload.queryPlan.rowLimit, 200);
        assert.equal(payload.safety.rawSqlAccepted, false);
        assert.ok(payload.safety.returnedRows <= 200);
        assert.equal(payload.gateway.decision, "allow");
        assert.equal(payload.gateway.enforcedBy, "secure_demo_gateway");
        assert.equal(payload.gateway.identityVerified, true);
        assert.equal(payload.gateway.identityProvider, "secure_demo");
        assert.equal(payload.planner.mode, "deterministic_fallback");
        assert.equal(payload.planner.reason, "ai_not_configured");
        assert.equal(payload.planner.validated, true);
        assert.ok(Date.parse(payload.gateway.identityExpiresAt) > Date.now());
        assert.match(payload.gateway.decisionId, /^decision_/);
        assert.ok(payload.gateway.policyVersion.length > 0);
        assert.equal(payload.gateway.catalogVersion, payload.queryPlan.catalogVersion);
        return payload;
      }),
    );

    assert.equal(new Set(results.map((result) => result.spec.title)).size, 4);
    assert.equal(new Set(results.map((result) => result.queryPlan.entity)).size, 3);
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});

test("the API rejects invalid and unsupported input without querying data", async () => {
  const invalidResponse = await POST(
    new Request("http://localhost/api/workspaces/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin:"http://localhost" },
      body: JSON.stringify({ prompt: "short" }),
    }),
  );
  assert.equal(invalidResponse.status, 400);

  const unsupportedResponse = await POST(
    new Request("http://localhost/api/workspaces/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin:"http://localhost" },
      body: JSON.stringify({ prompt: "Build a payroll workspace for contractors" }),
    }),
  );
  assert.equal(unsupportedResponse.status, 422);
  const payload = await unsupportedResponse.json();
  assert.equal(payload.code, "unsupported_workspace_request");
  assert.equal(payload.suggestions.length, 4);
});

test("a database URL cannot bypass the client Gateway boundary", async () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousGatewayUrl = process.env.MORPH_GATEWAY_URL;
  process.env.DATABASE_URL = "postgresql://direct-access-must-not-be-used.invalid";
  delete process.env.MORPH_GATEWAY_URL;

  try {
    const response = await POST(
      new Request("http://localhost/api/workspaces/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin:"http://localhost" },
        body: JSON.stringify({
          prompt: "Show the active policy portfolio by product",
          limit: 20,
        }),
      }),
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.sourceMode, "secure_demo");
    assert.equal(payload.gateway.enforcedBy, "secure_demo_gateway");
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    process.env.MORPH_AUTH_MODE="demo";
    if (previousGatewayUrl === undefined) delete process.env.MORPH_GATEWAY_URL;
    else process.env.MORPH_GATEWAY_URL = previousGatewayUrl;
  }
});

test("a configured client Gateway fails closed without a signed identity assertion", async () => {
  const previousGatewayUrl = process.env.MORPH_GATEWAY_URL;
  process.env.MORPH_GATEWAY_URL = "https://gateway.atlas.example";
  process.env.MORPH_AUTH_MODE="oidc";

  try {
    const response = await POST(
      new Request("http://localhost/api/workspaces/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin:"http://localhost" },
        body: JSON.stringify({
          prompt: "Show high-value claims reported this month by branch",
          limit: 20,
        }),
      }),
    );
    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.code, "invalid_origin");
  } finally {
    process.env.MORPH_AUTH_MODE="demo";
    if (previousGatewayUrl === undefined) delete process.env.MORPH_GATEWAY_URL;
    else process.env.MORPH_GATEWAY_URL = previousGatewayUrl;
  }
});
