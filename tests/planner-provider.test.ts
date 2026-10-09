import assert from "node:assert/strict";
import { test } from "node:test";
import { planWorkspaceRequestWithAi, validateProposal, type AiWorkspaceProposal } from "../lib/workspaces/ai-planner";
import { insuranceSemanticCatalog } from "../lib/catalog/semantic";

test("model date ranges are canonicalized and invalid calendar bounds rejected", () => {
  const proposal: AiWorkspaceProposal = {
    supported: true, intent: "renewals", entity: "policies", title: "Renewals", interpretation: "Upcoming policies",
    fields: ["policy_number", "total_premium", "relationship_manager"],
    filters: [{ field: "expiry_date", operator: "between", value: "2026-09-16,2026-10-01" }],
    groupBy: null, orderBy: [], metricIds: [], visualization: "table",
    presentation: { blocks: ["table"], tableLayout: "records" }, unsupportedReason: "",
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
  const previousModel = process.env.MORPH_PLANNER_MODEL;
  delete process.env.MORPH_PLANNER_MODEL;
  process.env.MORPH_AI_PLANNER_ENABLED = "true";
  t.after(() => {
    if (previousModel === undefined) delete process.env.MORPH_PLANNER_MODEL;
    else process.env.MORPH_PLANNER_MODEL = previousModel;
    if (previous === undefined) delete process.env.MORPH_AI_PLANNER_ENABLED;
    else process.env.MORPH_AI_PLANNER_ENABLED = previous;
  });
  const proposal = {
    supported: true, intent: "endorsements", entity: "endorsements",
    analysis: { metricId: "endorsement_count", time: null, comparison: "none" },
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
    assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("x-goog-api-key"), "test-google-key");
    assert.equal(headers.has("authorization"), false);
    const body = JSON.parse(String(init.body));
    assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    const wireSchema = body.generationConfig.responseJsonSchema || body.generationConfig.responseSchema;
    assert.ok(wireSchema);
    const fieldChoices = wireSchema.properties.fields.items.enum;
    assert.deepEqual([...fieldChoices].sort(), [...new Set(insuranceSemanticCatalog.entities.flatMap(entity => entity.fields.map(field => field.name)))].sort());
    assert.ok(!fieldChoices.includes('record_count'));
    assert.ok(!fieldChoices.includes('premium'));
    return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify({ ...proposal, chartValue: null }) }] }, finishReason: "STOP" }] });
  });
  const options = { allowFallback: true, provider: "google" as const, apiKey: "test-google-key" };
  const result = await planWorkspaceRequestWithAi("Show pending endorsements grouped by type in a table only", insuranceSemanticCatalog, 200, options);
  assert.equal(result.planner.mode, "ai");
  assert.deepEqual(result.plan.presentation.blocks, ["table"]);
  proposal.fields = ["bank_account_number"];
  const rejected = await planWorkspaceRequestWithAi("Show pending endorsements", insuranceSemanticCatalog, 200, options);
  assert.equal(rejected.planner.reason, "ai_plan_rejected");
  assert.equal(rejected.plan.fields.includes("bank_account_number"), false);
  assert.equal(calls.length, 3);
});

test("explicit compatibility mode labels Google authentication fallback without calling OpenAI", async (t) => {
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
    allowFallback: true, provider: "google", model: "gemini-flash-latest", apiKey: "test-google-key",
  });
  assert.equal(result.planner.mode, "deterministic_fallback");
  assert.equal(result.planner.reason, "ai_plan_rejected");
  assert.equal(calls, 1);
});

test("OpenAI receives a strict generation schema with required nullable analysis and chartValue", async (t) => {
  const previous = process.env.MORPH_AI_PLANNER_ENABLED;
  process.env.MORPH_AI_PLANNER_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.MORPH_AI_PLANNER_ENABLED;
    else process.env.MORPH_AI_PLANNER_ENABLED = previous;
  });
  let calls = 0;
  let format: { strict: boolean; schema: { properties: Record<string, unknown>; required: string[] } } | undefined;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    assert.equal(String(url), "https://api.openai.com/v1/responses");
    const body = JSON.parse(String(init.body));
    assert.equal(body.store, false);
    format = body.text?.format;
    // No external request: provider rejection also exercises the safe error path.
    return Response.json({ error: { message: "private mocked credential rejection", type: "invalid_request_error", code: "invalid_api_key" } }, { status: 403 });
  });
  await assert.rejects(
    planWorkspaceRequestWithAi("Show monthly premium growth as a percentage line chart", insuranceSemanticCatalog, 200, {
      provider: "openai", model: "test-only-model", apiKey: "test-openai-key",
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /credentials|authentication|configuration/i);
      assert.doesNotMatch(error.message, /private mocked credential rejection|test-openai-key/);
      return true;
    },
  );
  assert.equal(calls, 1);
  assert.ok(format);
  assert.equal(format.strict, true);
  assert.deepEqual([...format.schema.required].sort(), Object.keys(format.schema.properties).sort());
  for (const field of ["analysis", "chartValue"]) {
    assert.ok(format.schema.required.includes(field), `${field} must be required by the provider schema`);
    assert.match(JSON.stringify(format.schema.properties[field]), /"null"/, `${field} must allow null`);
  }
});

test('a transient Google service error is retried within the shared request deadline', async t => {
  const previous = process.env.MORPH_AI_PLANNER_ENABLED;
  process.env.MORPH_AI_PLANNER_ENABLED = 'true';
  t.after(() => { if (previous === undefined) delete process.env.MORPH_AI_PLANNER_ENABLED; else process.env.MORPH_AI_PLANNER_ENABLED = previous; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return Response.json({ error: { code: 503, status: 'UNAVAILABLE', message: 'Transient service error' } }, { status: 503 });
    const proposal: AiWorkspaceProposal = {
      supported: true, intent: 'endorsements', entity: 'endorsements',
      title: 'Pending endorsements', interpretation: 'Pending requests grouped by type.',
      fields: ['type'], filters: [{ field: 'status', operator: 'in', value: 'requested,documents_pending,under_review' }],
      analysis: { metricId: 'endorsement_count', time: null, comparison: 'none' }, chartValue: null,
      groupBy: 'type', orderBy: [], metricIds: [], visualization: 'table',
      presentation: { blocks: ['table'], tableLayout: 'grouped_summary' }, unsupportedReason: '',
    };
    return Response.json({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(proposal) }] }, finishReason: 'STOP' }] });
  });
  const result = await planWorkspaceRequestWithAi('Show pending endorsements grouped by type. Table only.', insuranceSemanticCatalog, 200, { provider: 'google', apiKey: 'test-only-google-key' });
  assert.equal(result.planner.mode, 'ai');
  assert.equal(calls, 2);
});
