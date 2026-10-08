import { createOpenAI } from "@ai-sdk/openai";
import { createGoogle } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import { gatewayAnalysisSchema } from "@/lib/gateway/contract";
import { validateAnalysis } from "@/lib/gateway/analysis";
import {
  semanticEntityNameSchema,
  semanticFilterOperatorSchema,
  type SemanticCatalog,
  type SemanticEntity,
} from "@/lib/catalog/semantic";
import {
  planWorkspaceRequest,
  UnsupportedWorkspaceRequestError,
  type WorkspaceBlockType,
  type WorkspacePlan,
} from "./dynamic";

const DEFAULT_PLANNER_MODELS = {
  openai: "gpt-5.6-luna",
  google: "gemini-flash-latest",
} as const;
type PlannerProvider = keyof typeof DEFAULT_PLANNER_MODELS;

const aiFilterSchema = z
  .object({
    field: z.string().regex(/^[a-z0-9_]+$/),
    operator: semanticFilterOperatorSchema,
    value: z.union([z.string(), z.number()]),
  })
  .strict();

export const aiWorkspaceProposalSchema = z
  .object({
    analysis: gatewayAnalysisSchema.nullable().optional(),
    chartValue: z.enum(["value", "change_amount", "change_percent"]).nullable().optional(),
    supported: z.boolean(),
    intent: z.enum(["renewals", "claims", "endorsements", "policies"]),
    entity: semanticEntityNameSchema,
    title: z.string().min(1).max(100),
    interpretation: z.string().min(1).max(240),
    fields: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1).max(30),
    filters: z.array(aiFilterSchema).max(12),
    groupBy: z.string().regex(/^[a-z0-9_]+$/).nullable(),
    orderBy: z
      .array(
        z
          .object({
            field: z.string().regex(/^[a-z0-9_]+$/),
            direction: z.enum(["asc", "desc"]),
          })
          .strict(),
      )
      .max(3),
    metricIds: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(6),
    visualization: z.enum(["bar", "donut", "line", "table"]),
    presentation: z
      .object({
        blocks: z
          .array(z.enum(["metrics", "filters", "chart", "table"]))
          .min(1)
          .max(4),
        tableLayout: z.enum(["grouped_summary", "records"]),
      })
      .strict(),
    unsupportedReason: z.string().max(240),
  })
  .strict();

// OpenAI strict structured output requires every property, with null for absence.
const providerProposalSchema = aiWorkspaceProposalSchema.extend({
  analysis: gatewayAnalysisSchema.nullable(),
  chartValue: z.enum(["value", "change_amount", "change_percent"]).nullable(),
});

export type AiWorkspaceProposal = z.infer<typeof aiWorkspaceProposalSchema>;

export type WorkspacePlannerMetadata = {
  mode: "ai" | "deterministic_fallback";
  model: string | null;
  validated: true;
  reason: "ai_plan" | "ai_not_configured" | "ai_plan_rejected";
  failureCode?:'not_configured'|'authentication'|'quota'|'timeout'|'invalid_plan'|'unavailable';
  message?:string;
};

export type WorkspacePlannerResult = {
  plan: WorkspacePlan;
  planner: WorkspacePlannerMetadata;
};

type ProposalInput = {
  prompt: string;
  catalog: SemanticCatalog;
  limit: number;
  model: string;
  validationFeedback?: string;
};

type PlannerOptions = {
  requireAi?:boolean;
  allowFallback?:boolean;
  provider?: PlannerProvider;
  apiKey?: string;
  model?: string;
  generateProposal?: (input: ProposalInput) => Promise<unknown>;
};

export async function planWorkspaceRequestWithAi(
  prompt: string,
  catalog: SemanticCatalog,
  requestedLimit = 200,
  options: PlannerOptions = {},
): Promise<WorkspacePlannerResult> {
  const configuredProvider = options.provider ?? process.env.MORPH_PLANNER_PROVIDER ?? "openai";
  if (configuredProvider !== "openai" && configuredProvider !== "google") {
    if (!options.allowFallback || options.requireAi) throw new WorkspacePlannerUnavailableError("not_configured");
    return fallbackPlan(prompt, catalog, requestedLimit, null, "ai_not_configured");
  }
  const provider = configuredProvider;
  const apiKey = options.apiKey?.trim() || (provider === "google"
    ? process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
    : process.env.OPENAI_API_KEY?.trim());
  const model = options.model?.trim() || process.env.MORPH_PLANNER_MODEL?.trim() || DEFAULT_PLANNER_MODELS[provider];
  const enabled = Boolean(options.generateProposal) || process.env.MORPH_AI_PLANNER_ENABLED === "true";

  if (!enabled || (!options.generateProposal && !apiKey)) {
    if (!options.allowFallback || options.requireAi) throw new WorkspacePlannerUnavailableError("not_configured");
    return fallbackPlan(prompt, catalog, requestedLimit, null, "ai_not_configured");
  }

  const signal = AbortSignal.timeout(30_000);
  let validationFeedback: string | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    let stage: "generation" | "schema" | "validation" = "generation";
    try {
      const input = { prompt, catalog, limit: requestedLimit, model, validationFeedback };
      const rawProposal = options.generateProposal
        ? await options.generateProposal(input)
        : await generateProposalWithModel(input, apiKey!, provider, signal);
      stage = "schema";
      const proposal = aiWorkspaceProposalSchema.parse(rawProposal);
      if (!proposal.supported) throw new UnsupportedWorkspaceRequestError(proposal.unsupportedReason || 'Please specify the dataset, filters and preferred view.');
      stage = "validation";
      assertPresentationPreference(prompt, proposal);
      const plan = validateProposal(proposal, catalog, requestedLimit);
      return { plan, planner: { mode: "ai", model, validated: true, reason: "ai_plan" } };
    } catch (error) {
      if (error instanceof UnsupportedWorkspaceRequestError) throw error;
      const failureCode = classifyPlannerFailure(error);
      const detail = safePlannerValidationFeedback(error);
      console.warn(JSON.stringify({ type: "morph_planner_failure", failureCode, stage, attempt: attempt + 1, detail }));
      if (failureCode === "invalid_plan" && attempt === 0 && !signal.aborted) {
        validationFeedback = detail;
        continue;
      }
      if (!options.allowFallback || options.requireAi) throw new WorkspacePlannerUnavailableError(failureCode);
      const result = fallbackPlan(prompt, catalog, requestedLimit, model, "ai_plan_rejected");
      result.planner.failureCode = failureCode;
      result.planner.message = plannerFailureMessages[failureCode];
      return result;
    }
  }
  throw new WorkspacePlannerUnavailableError("invalid_plan");
}

async function generateProposalWithModel(
  input: ProposalInput,
  apiKey: string,
  providerName: PlannerProvider,
  signal: AbortSignal,
): Promise<AiWorkspaceProposal> {
  const provider = providerName === "google" ? createGoogle({ apiKey }) : createOpenAI({ apiKey });
  const result = await generateText({
    model: provider(input.model),
    output: Output.object({ schema: providerProposalSchema }),
    abortSignal: signal,
    maxRetries: 0,
    system: buildPlannerInstructions(input.catalog),
    prompt: [
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      `Maximum rows: ${Math.min(200, Math.max(1, input.limit))}.`,
      `User request: ${input.prompt}`,
      ...(input.validationFeedback ? [`Your previous proposal failed validation: ${input.validationFeedback}`, "Return a corrected plan for the SAME request. Do not weaken constraints, add unavailable fields, or change the requested format. If it cannot be represented, set supported=false and explain why."] : []),
    ].join("\n"),
    providerOptions: providerName === "openai" ? {
      openai: {
        store: false,
      },
    } : undefined,
  });
  return result.output;
}

function buildPlannerInstructions(catalog: SemanticCatalog) {
  const safeCatalog = {
    catalogVersion: catalog.catalogVersion,
    entities: catalog.entities.map((entity) => ({
      entity: entity.entity,
      label: entity.label,
      description: entity.description,
      synonyms: entity.synonyms,
      defaultFields: entity.defaultFields,
      dateField: entity.dateField,
      amountField: entity.amountField,
      statusField: entity.statusField,
      fields: entity.fields.map((field) => ({
        name: field.name,
        label: field.label,
        description: field.description,
        semanticType: field.semanticType,
        dataType: field.dataType,
        aggregations: field.aggregations,
        masked: field.masked,
        synonyms: field.synonyms,
        filterOperators: field.filterOperators,
        groupable: field.groupable,
        sortable: field.sortable,
        allowedValues: field.allowedValues,
        valueSets: field.valueSets,
      })),
      analysisAllowed: entity.analysisAllowed,
      metrics: entity.metrics,
    })),
    relationships: catalog.relationships,
  };

  return [
    "You are the semantic workspace planner for MorphUI.",
    "Understand the user's business question and presentation preference, then return only the typed plan.",
    "Use only entities, fields, operators, values, metrics, and relationships supplied in the approved catalogue.",
    "Never create SQL, joins, fields, permissions, or calculations outside the catalogue. For fields with allowedValues, use only those values. For free-text filters, use exact values explicitly supplied by the user; never invent product, branch or manager names.",
    "The UI composition must fit the request instead of defaulting every request to the same dashboard.",
    "Use a records table for record-level lists, a grouped-summary table for grouped table requests, charts for comparisons or trends, metrics for headline totals, and multiple blocks only when a dashboard is requested or clearly useful.",
    "Honor explicit inclusion and exclusion instructions such as only, without, omit, concise, detailed, chart, table, cards, or dashboard.",
    "For complete totals, counts, averages, grouped summaries, category comparisons or time trends, supply analysis with ONE approved metricId, optional time {field,grain:day|week|month|year,start,end}, and comparison:none|previous_bucket. This aggregates all matching records inside the Gateway before result limits. Set analysis=null for individual record lists. Never claim a record sample is a portfolio total.",
    "Growth MUST use time buckets and comparison=previous_bucket, with complete calendar periods. For policy premium use total_premium and coverage start_date when approved, and explicitly state that date basis. If the user does not specify a period, ask which period to compare; never substitute expiry dates or a category comparison. For trends without a comparison you may show partial periods, explicitly described as such.",
    "chartValue chooses the displayed measure: value for premium levels/ordinary totals, change_amount for absolute growth, change_percent for percentage growth. A chart-only request for growth must use change_amount or change_percent. Percentage growth must use change_percent; comparison=previous_bucket is mandatory for either change display. Undefined baselines appear as unavailable, never zero. Donut charts cannot display period changes or averages. For analysis tables use grouped_summary even when grouping by time rather than a category. For metrics blocks leave metricIds empty or choose only the analysis metric; do not request additional aggregations.",
    "A line chart requires time analysis without an additional category grouping. Category comparisons use bar or donut charts. Donuts show nonnegative parts of one whole, not growth. For analysis use orderBy=[] and select measure/date/group source fields only. A grouped summary table must use analysis; record tables must use analysis=null. Do not silently turn a requested list plus full-population analytics into a grouped table: ask which view to prioritize.",
    "If analysisAllowed=false, complete population analytics are unavailable: explain this rather than returning sampled totals. Only supported calculations are catalogue count, sum and average. Forecasts, ratios, multi-entity joins, writes and unavailable issuance-date analyses require a limitation or clarification, never fabricated data.",
    "For business terms such as pending or open, translate them through the catalogue's valueSets and return their concrete allowed values as a comma-separated `in` filter.",
    "For relative dates, use today's date and encode between filters as YYYY-MM-DD..YYYY-MM-DD (two dots between the dates).",
    "Set supported=false when the request cannot be represented by this catalogue; still populate all required fields with conservative catalogue values.",
    "If a necessary dataset or measure is ambiguous, set supported=false and put one concise clarification question in unsupportedReason. Do not silently invent business intent.",
    `Approved catalogue: ${JSON.stringify(safeCatalog)}`,
  ].join("\n");
}

export function validateProposal(
  input: AiWorkspaceProposal,
  catalog: SemanticCatalog,
  requestedLimit = 200,
): WorkspacePlan {
  const proposal = aiWorkspaceProposalSchema.parse(input);
  const entity = catalog.entities.find((candidate) => candidate.entity === proposal.entity);
  if (!entity || !proposal.supported) throw new UnsupportedWorkspaceRequestError();
  if (proposal.intent === "renewals" ? entity.entity !== "policies" : proposal.intent !== entity.entity) {
    throw new Error("AI intent does not match its selected catalogue entity.");
  }

  const fieldMap = new Map(entity.fields.map((field) => [field.name, field]));
  const groupBy = proposal.groupBy ?? undefined;
  if (groupBy && !fieldMap.get(groupBy)?.groupable) {
    throw new Error("AI selected a field that is not approved for grouping.");
  }

  const filters = proposal.filters.map((filter) => {
    const field = fieldMap.get(filter.field);
    if (!field || !field.filterOperators.includes(filter.operator)) {
      throw new Error("AI selected a filter outside the approved catalogue.");
    }
    let value = filter.value;
    if (field.dataType === "date" && filter.operator === "between") {
      const range = typeof value === "string"
        ? /^(\d{4}-\d{2}-\d{2})\s*(?:\.\.|,)\s*(\d{4}-\d{2}-\d{2})$/.exec(value.trim())
        : null;
      if (!range) throw new Error("AI returned an invalid date range.");
      const [, start, end] = range;
      if ([start, end].some((date) => !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) || start > end) {
        throw new Error("AI returned invalid or reversed date bounds.");
      }
      value = `${start}..${end}`;
    }
    validateFilterValue(field, filter.operator, value);
    return { ...filter, value };
  });

  const orderBy = proposal.orderBy.map((sort) => {
    if (!fieldMap.get(sort.field)?.sortable) {
      throw new Error("AI selected a sort outside the approved catalogue.");
    }
    return sort;
  });
  const metrics = proposal.metricIds.map((metricId) => {
    const metric = entity.metrics.find((candidate) => candidate.id === metricId);
    if (!metric) throw new Error("AI selected a metric outside the approved catalogue.");
    return metric;
  });
  const blocks = Array.from(new Set(proposal.presentation.blocks)) as WorkspaceBlockType[];
  if (blocks.includes("chart") && proposal.visualization === "line" && (!proposal.analysis?.time || groupBy)) {
    throw new Error("A line trend requires time analysis without category grouping.");
  }
  if (blocks.includes("chart") && ((!groupBy && !proposal.analysis?.time) || proposal.visualization === "table")) {
    throw new Error("AI chart plans require an approved grouping and chart visualization.");
  }
  if (proposal.presentation.tableLayout === "grouped_summary" && !groupBy && !proposal.analysis) {
    throw new Error("AI grouped tables require an approved grouping field.");
  }

  if (!proposal.analysis && (blocks.includes("chart") || blocks.includes("metrics") || proposal.presentation.tableLayout === "grouped_summary")) {
    throw new Error("Analytical views require a complete Gateway analysis rather than a record sample.");
  }

  const requiredFields = [
    ...proposal.fields,
    ...(groupBy ? [groupBy] : []),
    ...metrics.flatMap((metric) => metric.field ?? []),
    ...(proposal.analysis?.time ? [proposal.analysis.time.field] : []),
    ...(proposal.analysis ? entity.metrics.filter(metric => metric.id === proposal.analysis!.metricId).flatMap(metric => metric.field ?? []) : []),
  ];
  const fields = Array.from(new Set(requiredFields));
  if (!fields.length || fields.length > 30 || fields.some((field) => !fieldMap.has(field))) {
    throw new Error("AI selected fields outside the approved catalogue.");
  }

  const days = inferDays(filters, entity);
  const minimumAmount = inferMinimumAmount(filters, entity);

  const plan: WorkspacePlan = {
    ...(proposal.analysis ? { analysis: proposal.analysis } : {}),
    chartValue: proposal.chartValue ?? "value",
    intent: proposal.intent,
    title: proposal.title,
    interpretation: proposal.interpretation,
    catalogVersion: catalog.catalogVersion,
    entity: entity.entity,
    source: entity.source,
    fields,
    filters,
    groupBy,
    orderBy,
    metrics: blocks.includes("metrics") && !metrics.length ? entity.metrics : metrics,
    visualization: proposal.visualization,
    presentation: {
      mode: inferPresentationMode(blocks),
      blocks,
      tableLayout: proposal.presentation.tableLayout,
    },
    days,
    minimumAmount,
    limit: Math.min(200, Math.max(1, requestedLimit), entity.maximumRows),
  };
  if (proposal.chartValue && proposal.chartValue !== "value" && proposal.analysis?.comparison !== "previous_bucket") throw new Error("A change chart requires period comparisons.");
  if (blocks.includes("chart") && proposal.visualization === "donut" && (proposal.chartValue && proposal.chartValue !== "value" || proposal.analysis?.comparison === "previous_bucket")) throw new Error("Growth cannot be displayed as parts of a whole.");
  if (proposal.analysis) {
    const {metric} = validateAnalysis({ ...plan, operation: "select", rowLimit: plan.limit }, entity);
    if (blocks.includes("chart") && proposal.visualization === "donut" && metric.operation === "average") throw new Error("Averages do not form additive parts of a whole.");
    if (blocks.includes("table") && proposal.presentation.tableLayout === "records") throw new Error("An aggregate answer cannot return individual records.");
    if (proposal.metricIds.some(id => id !== proposal.analysis!.metricId)) throw new Error("An analysis returns only its selected metric.");
  }
  return plan;
}

function validateFilterValue(
  field: SemanticEntity["fields"][number],
  operator: z.infer<typeof semanticFilterOperatorSchema>,
  value: string | number,
) {
  if (!field.allowedValues.length || (operator !== "equals" && operator !== "in")) return;
  const values = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  if (!values.length || values.some((item) => !field.allowedValues.includes(item))) {
    throw new Error("AI selected a categorical value outside the approved catalogue.");
  }
}

function inferDays(filters: AiWorkspaceProposal["filters"], entity: SemanticEntity) {
  const range = filters.find(
    (filter) => filter.field === entity.dateField && filter.operator === "between" && typeof filter.value === "string",
  );
  if (!range || typeof range.value !== "string") return 15;
  const [start, end] = range.value.split("..").map((value) => Date.parse(value));
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 15;
  return Math.min(90, Math.max(1, Math.ceil((end - start) / 86_400_000)));
}

function inferMinimumAmount(filters: AiWorkspaceProposal["filters"], entity: SemanticEntity) {
  const amount = filters.find(
    (filter) => filter.field === entity.amountField && filter.operator === "greater_than" && typeof filter.value === "number",
  );
  return amount && typeof amount.value === "number" ? amount.value : 0;
}

function inferPresentationMode(blocks: WorkspaceBlockType[]): WorkspacePlan["presentation"]["mode"] {
  if (blocks.length === 1 && blocks[0] === "table") return "table_only";
  if (blocks.length === 1 && blocks[0] === "chart") return "chart_only";
  if (blocks.length === 1 && blocks[0] === "metrics") return "metrics_only";
  return blocks.length > 2 ? "dashboard" : "auto";
}

function fallbackPlan(
  prompt: string,
  catalog: SemanticCatalog,
  requestedLimit: number,
  model: string | null,
  reason: "ai_not_configured" | "ai_plan_rejected",
): WorkspacePlannerResult {
  return {
    plan: planWorkspaceRequest(prompt, catalog, requestedLimit),
    planner: {
      mode: "deterministic_fallback",
      model,
      validated: true,
      reason,
      failureCode:reason==='ai_not_configured'?'not_configured':'invalid_plan',
      message:reason==='ai_not_configured'?plannerFailureMessages.not_configured:plannerFailureMessages.invalid_plan,
    },
  };
}

// Only fixed application messages may enter logs or correction feedback. Provider
// exceptions, Zod input values, and raw model output can contain sensitive text.
const safeValidationMessages = new Set([
  "AI intent does not match its selected catalogue entity.",
  "AI selected a field that is not approved for grouping.",
  "AI selected a filter outside the approved catalogue.",
  "AI returned an invalid date range.",
  "AI returned invalid or reversed date bounds.",
  "AI selected a sort outside the approved catalogue.",
  "AI selected a metric outside the approved catalogue.",
  "A line trend requires time analysis without category grouping.",
  "AI chart plans require an approved grouping and chart visualization.",
  "AI grouped tables require an approved grouping field.",
  "Analytical views require a complete Gateway analysis rather than a record sample.",
  "AI selected fields outside the approved catalogue.",
  "A change chart requires period comparisons.",
  "Growth cannot be displayed as parts of a whole.",
  "Averages do not form additive parts of a whole.",
  "An aggregate answer cannot return individual records.",
  "An analysis returns only its selected metric.",
  "AI selected a categorical value outside the approved catalogue.",
  "The display must show the requested percentage change.",
  "The proposed display format contradicts the explicit only instruction.",
  "The request excludes charts.",
  "An analysis definition is required.",
  "This analytic metric is not approved.",
  "Analysis cannot use an unavailable or masked measure.",
  "This calculation is not approved for the measure.",
  "The analysis grouping is not approved.",
  "Growth requires time buckets.",
  "The analysis date is not approved.",
  "Use an ordered analysis period of at most five years.",
  "Growth comparisons require complete calendar periods.",
  "Analyses use chronological or category order; record sorting is not applicable.",
  "Invalid analysis date."
]);
function safePlannerValidationFeedback(error: unknown): string {
  if (error instanceof Error && safeValidationMessages.has(error.message)) return error.message;
  let current = error;
  const keys = new Set([...Object.keys(aiWorkspaceProposalSchema.shape), "blocks", "tableLayout", "field", "operator", "value", "direction", "metricId", "time", "comparison", "grain", "start", "end"]);
  for (let depth = 0; depth < 4 && current instanceof Error; depth++) {
    if (current instanceof z.ZodError) {
      const paths = current.issues.slice(0, 4).map(issue => issue.path.filter(part => typeof part === "string" && keys.has(part)).join(".") || "plan");
      return `Schema constraints failed for: ${paths.join(", ")}. Use exactly the required schema, including length limits and null for absent optional values.`;
    }
    current = current.cause;
  }
  return "The response must match the complete structured plan schema and approved catalogue. Check required properties, nullable fields, field names, metric IDs, operators and requested presentation.";
}

const plannerFailureMessages = {
  not_configured:'AI planning has not been configured for this connection.',
  authentication:'The AI provider rejected its credentials. Ask an administrator to check the server configuration.',
  quota:'The AI provider quota or rate limit was reached. Retry later.',
  timeout:'The AI provider took too long to respond. You can retry the request.',
  invalid_plan:'The AI response could not be validated against the approved data and display format. Rephrase the request or specify its dataset, measure and period.',
  unavailable:'The AI provider is temporarily unavailable. You can retry shortly.',
} as const;
export class WorkspacePlannerUnavailableError extends Error {
  constructor(readonly failureCode: keyof typeof plannerFailureMessages) { super(plannerFailureMessages[failureCode]); }
}
export function classifyPlannerFailure(error:unknown):keyof typeof plannerFailureMessages {
  let current=error;
  for(let depth=0;depth<4&&current&&typeof current==='object';depth++) {
    const value=current as {statusCode?:number;status?:number;name?:string;cause?:unknown};
    const status=value.statusCode??value.status;
    if(status===401||status===403) return 'authentication';
    if(status===429) return 'quota';
    if(status&&status>=500) return 'unavailable';
    if(value.name==='TimeoutError'||value.name==='AbortError') return 'timeout';
    current=value.cause;
  }
  return 'invalid_plan';
}

// These are explicit display constraints, not business-intent routing. The model
// still selects the catalogue entity, filters, measure, date basis and grouping.
function assertPresentationPreference(prompt: string, proposal: AiWorkspaceProposal) {
  const text = prompt.toLowerCase();
  const only = /\b(?:normal\s+)?table\s+only\b|\bonly\s+(?:a\s+)?(?:normal\s+)?table\b|\bjust\s+(?:a\s+)?table\b/.test(text) ? "table"
    : /\b(?:chart|graph)\s+only\b|\bonly\s+(?:a\s+)?(?:chart|graph)\b/.test(text) ? "chart"
      : /\b(?:metrics?|kpis?)\s+only\b/.test(text) ? "metrics" : undefined;
  if (proposal.presentation.blocks.includes("chart") && /\b(?:growth|increase|decrease|change)\b/.test(text) && /\b(?:percentage|percent)\b|%/.test(text) && proposal.chartValue !== "change_percent") throw new Error("The display must show the requested percentage change.");
  if (only && (proposal.presentation.blocks.length !== 1 || proposal.presentation.blocks[0] !== only)) {
    throw new Error("The proposed display format contradicts the explicit only instruction.");
  }
  if (/\b(?:no|without|omit|hide)\s+(?:charts?|graphs?)\b/.test(text) && proposal.presentation.blocks.includes("chart")) {
    throw new Error("The request excludes charts.");
  }
}
