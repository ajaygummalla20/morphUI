import assert from "node:assert/strict";
import { test } from "node:test";
import {
  planWorkspaceRequestWithAi,
  validateProposal,
  type AiWorkspaceProposal,
} from "../lib/workspaces/ai-planner";
import { UnsupportedWorkspaceRequestError } from "../lib/workspaces/dynamic";
import { insuranceSemanticCatalog } from "../lib/catalog/semantic";

const tableProposal: AiWorkspaceProposal = {
  supported: true,
  intent: "endorsements",
  entity: "endorsements",
  analysis: { metricId: "endorsement_count", time: null, comparison: "none" },
  title: "Pending endorsements by type",
  interpretation: "Only a table of pending endorsements grouped by type.",
  fields: ["type", "premium_delta"],
  filters: [{ field: "status", operator: "in", value: "requested,documents_pending,under_review" }],
  groupBy: "type",
  orderBy: [],
  metricIds: [],
  visualization: "table",
  presentation: { blocks: ["table"], tableLayout: "grouped_summary" },
  unsupportedReason: "",
};

test("an unconfigured AI planner reports configuration instead of fabricating a dashboard", async (t) => {
  const names = ["MORPH_AI_PLANNER_ENABLED", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "MORPH_PLANNER_PROVIDER"] as const;
  const previous = names.map((name) => process.env[name]);
  for (const name of names) delete process.env[name];
  t.after(() => names.forEach((name, index) => {
    if (previous[index] === undefined) delete process.env[name];
    else process.env[name] = previous[index];
  }));
  await assert.rejects(
    planWorkspaceRequestWithAi("Show growth in premium on policies as a visual", insuranceSemanticCatalog),
    /configur/i,
  );
});

for (const [label, failure, expected] of [
  ["credentials rejected", { statusCode: 403, message: "private provider credential details" }, /credentials|configuration|authentication/i],
  ["quota exhausted", { statusCode: 429 }, /quota|rate limit/i],
  ["provider timeout", { name: "TimeoutError" }, /too long|retry|timeout/i],
] as const) {
  test(`AI ${label} produces an actionable failure, not a different interpretation`, async () => {
    await assert.rejects(
      planWorkspaceRequestWithAi("Show premium growth on policies", insuranceSemanticCatalog, 200, {
        generateProposal: async () => { throw failure; },
      }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /private provider credential details/);
        return true;
      },
    );
  });
}

test("an administrator may explicitly opt into labelled compatibility fallback", async () => {
  const options = { allowFallback: true, generateProposal: async () => { throw { statusCode: 429 }; } };
  const result = await planWorkspaceRequestWithAi("Show pending endorsements", insuranceSemanticCatalog, 200, options);
  assert.equal(result.planner.mode, "deterministic_fallback");
  assert.equal(result.planner.failureCode, "quota");
  assert.match(result.planner.message ?? "", /quota|rate limit/i);
});

test("requireAi still prevents fallback even when compatibility fallback was requested", async () => {
  const options = { allowFallback: true, requireAi: true, generateProposal: async () => { throw { statusCode: 429 }; } };
  await assert.rejects(
    planWorkspaceRequestWithAi("Show pending endorsements", insuranceSemanticCatalog, 200, options),
    /quota/i,
  );
});

test("an ambiguous growth request surfaces the model's clarification even with fallback enabled", async () => {
  const question = "Which period should I compare, and should premium use policy issue date or expiry date?";
  const options = {
    allowFallback: true,
    generateProposal: async () => ({ ...tableProposal, supported: false, unsupportedReason: question }),
  };
  await assert.rejects(
    planWorkspaceRequestWithAi("Show growth in premium", insuranceSemanticCatalog, 200, options),
    (error: unknown) => {
      assert.ok(error instanceof UnsupportedWorkspaceRequestError);
      assert.equal(error.message, question);
      return true;
    },
  );
});

test("a categorical line chart cannot masquerade as premium growth over time", () => {
  const proposal: AiWorkspaceProposal = {
    ...tableProposal,
    intent: "policies",
    entity: "policies",
    title: "Premium growth",
    interpretation: "Premium growth by relationship manager.",
    fields: ["relationship_manager", "total_premium"],
    filters: [],
    groupBy: "relationship_manager",
    metricIds: ["written_premium"],
    visualization: "line",
    presentation: { blocks: ["chart"], tableLayout: "grouped_summary" },
  };
  assert.throws(() => validateProposal(proposal, insuranceSemanticCatalog), /date|time|trend|line/i);
});

test("a valid table-only request preserves the exact presentation without added charts or cards", async () => {
  const result = await planWorkspaceRequestWithAi(
    "Show pending endorsements grouped by type in a normal table only",
    insuranceSemanticCatalog,
    200,
    { generateProposal: async () => tableProposal },
  );
  assert.equal(result.planner.mode, "ai");
  assert.deepEqual(result.plan.presentation.blocks, ["table"]);
  assert.equal(result.plan.presentation.tableLayout, "grouped_summary");
  assert.equal(result.plan.visualization, "table");
});
test('explicit table-only instructions reject an otherwise valid chart proposal',async()=>{
 await assert.rejects(planWorkspaceRequestWithAi('Show pending endorsements grouped by type in a table only',insuranceSemanticCatalog,200,{generateProposal:async()=>({...tableProposal,visualization:'bar',presentation:{blocks:['chart'],tableLayout:'grouped_summary'}})}),/display format|validat/i);
});
