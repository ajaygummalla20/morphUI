import assert from "node:assert/strict";
import { test } from "node:test";
import { planWorkspaceRequestWithAi, validateProposal, type AiWorkspaceProposal } from "../lib/workspaces/ai-planner";
import { insuranceSemanticCatalog } from "../lib/catalog/semantic";

test("model date ranges are canonicalized and invalid calendar bounds rejected", () => {
  const proposal: AiWorkspaceProposal = {
    supported: true, intent: "renewals", entity: "policies", title: "Renewals", interpretation: "Upcoming policies",
    fields: ["policy_number", "total_premium", "relationship_manager"],
    filters: [{ field: "expiry_date", operator: "between", value: "2026-09-16,2026-10-01" }],
    groupBy: "relationship_manager", orderBy: [], metricIds: [], visualization: "donut",
    presentation: { blocks: ["chart", "table"], tableLayout: "records" }, unsupportedReason: "",
  };
  const result = validateProposal(proposal, insuranceSemanticCatalog);
  assert.equal(result.filters[0].value, "2026-09-16..2026-10-01");
  assert.equal(result.days, 15);
  for (const value of ["2026-10-01..2026-09-16", "2026-02-30..2026-03-15", "tomorrow..later"]) {
    proposal.filters[0].value = value;
    assert.throws(() => validateProposal(proposal, insuranceSemanticCatalog));
  }
});

test("Gemini sends structured-output requests only to Google and validates the result", async (t) => {
  const previous = process.env.MORPH_AI_PLANNER_ENABLED;
  process.env.MORPH_AI_PLANNER_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.MORPH_AI_PLANNER_ENABLED;
    else process.env.MORPH_AI_PLANNER_ENABLED = previous;
  });
  const proposal = {
    supported: true, intent: "endorsements", entity: "endorsements",
    title: "Pending endorsements by type", interpretation: "Grouped table only",
    fields: ["type", "premium_delta"],
    filters: [{ field: "status", operator: "in", value: "requested,documents_pending,under_review" }],
    groupBy: "type", orderBy: [], metricIds: [], visualization: "table",
    presentation: { blocks: ["table"], tableLayout: "grouped_summary" },
    unsupportedReason: "",
  };
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls.push(String(url));
    assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("x-goog-api-key"), "test-google-key");
    assert.equal(headers.has("authorization"), false);
    const body = JSON.parse(String(init.body));
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.ok(body.generationConfig.responseJsonSchema || body.generationConfig.responseSchema);
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(proposal) }] }, finishReason: "STOP" }] });
  });
  const options = { provider: "google" as const, model: "gemini-flash-latest", apiKey: "test-google-key" };
  const result = await planWorkspaceRequestWithAi("Show pending endorsements grouped by type in a table only", insuranceSemanticCatalog, 200, options);
  assert.equal(result.planner.mode, "ai");
  assert.deepEqual(result.plan.presentation.blocks, ["table"]);
  proposal.fields = ["bank_account_number"];
  const rejected = await planWorkspaceRequestWithAi("Show pending endorsements", insuranceSemanticCatalog, 200, options);
  assert.equal(rejected.planner.reason, "ai_plan_rejected");
  assert.equal(rejected.plan.fields.includes("bank_account_number"), false);
  assert.equal(calls.length, 2);
});

test("Google authentication failure uses safe fallback without calling OpenAI", async (t) => {
  const previous = process.env.MORPH_AI_PLANNER_ENABLED;
  process.env.MORPH_AI_PLANNER_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.MORPH_AI_PLANNER_ENABLED;
    else process.env.MORPH_AI_PLANNER_ENABLED = previous;
  });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls++;
    assert.equal(new URL(String(url)).hostname, "generativelanguage.googleapis.com");
    return Response.json({ error: { code: 403, status: "PERMISSION_DENIED", message: "Test denial" } }, { status: 403 });
  });
  const result = await planWorkspaceRequestWithAi("Show pending endorsements", insuranceSemanticCatalog, 200, {
    provider: "google", model: "gemini-flash-latest", apiKey: "test-google-key",
  });
  assert.equal(result.planner.mode, "deterministic_fallback");
  assert.equal(result.planner.reason, "ai_plan_rejected");
  assert.equal(calls, 1);
});
