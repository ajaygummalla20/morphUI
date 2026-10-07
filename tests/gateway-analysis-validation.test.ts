import assert from "node:assert/strict";
import { test } from "node:test";
import { insuranceSemanticCatalog } from "../lib/catalog/semantic";
import { validateAnalysis } from "../lib/gateway/analysis";
import type { GatewayQueryPlan } from "../lib/gateway/contract";
import { validateProposal } from "../lib/workspaces/ai-planner";

function premiumPlan(): GatewayQueryPlan {
  return {
    source: "policies_read_replica",
    catalogVersion: insuranceSemanticCatalog.catalogVersion,
    operation: "select",
    entity: "policies",
    fields: ["start_date", "total_premium"],
    filters: [],
    orderBy: [],
    rowLimit: 12,
    analysis: {
      metricId: "written_premium",
      time: { field: "start_date", grain: "month", start: "2026-01-01", end: "2026-03-31" },
      comparison: "previous_bucket",
    },
  };
}

for (const [label, fieldName] of [
  ["measure", "total_premium"],
  ["date", "start_date"],
  ["group", "branch"],
] as const) {
  test(`client-masked ${label} cannot be used to infer aggregates`, () => {
    const entity = structuredClone(insuranceSemanticCatalog.entities.find((entity) => entity.entity === "policies")!);
    entity.fields.find((field) => field.name === fieldName)!.masked = true;
    const plan = premiumPlan();
    if (label === "group") {
      plan.groupBy = "branch";
      plan.fields.push("branch");
    }
    assert.throws(() => validateAnalysis(plan, entity), /masked|approved|unavailable/i);
  });
}

test("monthly growth rejects a partial first or last calendar period", () => {
  const entity = insuranceSemanticCatalog.entities.find((entity) => entity.entity === "policies")!;
  for (const bounds of [
    { start: "2026-01-15", end: "2026-03-31" },
    { start: "2026-01-01", end: "2026-03-15" },
  ]) {
    const plan = premiumPlan();
    Object.assign(plan.analysis!.time!, bounds);
    assert.throws(() => validateAnalysis(plan, entity), /complete|calendar|period/i);
  }
});

test("monthly growth accepts complete calendar periods including the month's final day", () => {
  const entity = insuranceSemanticCatalog.entities.find((entity) => entity.entity === "policies")!;
  const result = validateAnalysis(premiumPlan(), entity);
  assert.equal(result.metric.id, "written_premium");
  assert.deepEqual(result.analysis.time, { field: "start_date", grain: "month", start: "2026-01-01", end: "2026-03-31" });
});

test("a valid time analysis renders a temporal line without inventing a categorical group", () => {
  const analysis = premiumPlan().analysis!;
  const proposal = {
    supported: true,
    intent: "policies" as const,
    entity: "policies" as const,
    title: "Monthly written premium growth",
    interpretation: "Compare written premium across complete months using policy start date.",
    fields: ["start_date", "total_premium"],
    filters: [],
    groupBy: null,
    orderBy: [],
    metricIds: ["written_premium"],
    visualization: "line" as const,
    presentation: { blocks: ["chart" as const], tableLayout: "grouped_summary" as const },
    unsupportedReason: "",
    analysis,
  };
  const result = validateProposal(proposal, insuranceSemanticCatalog);
  assert.equal(result.visualization, "line");
  assert.equal(result.groupBy, undefined);
  assert.ok("analysis" in result);
  assert.deepEqual(result.analysis, analysis);
});
