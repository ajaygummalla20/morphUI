import { createOpenAI } from "@ai-sdk/openai";
import { createGoogle } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
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
};

type PlannerOptions = {
  requireAi?:boolean;
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
    if (options.requireAi) throw new Error('AI planner is not configured.');
    return fallbackPlan(prompt, catalog, requestedLimit, null, "ai_not_configured");
  }
  const provider = configuredProvider;
  const apiKey = options.apiKey?.trim() || (provider === "google"
    ? process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim()
    : process.env.OPENAI_API_KEY?.trim());
  const model = options.model?.trim() || process.env.MORPH_PLANNER_MODEL?.trim() || DEFAULT_PLANNER_MODELS[provider];
  const enabled = Boolean(options.generateProposal) || process.env.MORPH_AI_PLANNER_ENABLED === "true";

  if (!enabled || (!options.generateProposal && !apiKey)) {
    if (options.requireAi) throw new Error('AI planner is not configured.');
    return fallbackPlan(prompt, catalog, requestedLimit, null, "ai_not_configured");
  }

  try {
    const rawProposal = options.generateProposal
      ? await options.generateProposal({ prompt, catalog, limit: requestedLimit, model })
      : await generateProposalWithModel({ prompt, catalog, limit: requestedLimit, model }, apiKey!, provider);
    const proposal = aiWorkspaceProposalSchema.parse(rawProposal);
    if (!proposal.supported) throw new UnsupportedWorkspaceRequestError(proposal.unsupportedReason || 'Please specify the dataset, filters and preferred view.');

    return {
      plan: validateProposal(proposal, catalog, requestedLimit),
      planner: {
        mode: "ai",
        model,
        validated: true,
        reason: "ai_plan",
      },
    };
  } catch (error) {
    if (error instanceof UnsupportedWorkspaceRequestError) throw error;
    const failureCode=classifyPlannerFailure(error);
    console.warn(JSON.stringify({type:'morph_planner_fallback',failureCode}));
    if(options.requireAi) throw new Error(`AI planner verification failed: ${failureCode}`);
    const result=fallbackPlan(prompt, catalog, requestedLimit, model, "ai_plan_rejected");
    result.planner.failureCode=failureCode;
    result.planner.message=plannerFailureMessages[failureCode];
    return result;
  }
}

async function generateProposalWithModel(
  input: ProposalInput,
  apiKey: string,
  providerName: PlannerProvider,
): Promise<AiWorkspaceProposal> {
  const provider = providerName === "google" ? createGoogle({ apiKey }) : createOpenAI({ apiKey });
  const result = await generateText({
    model: provider(input.model),
    output: Output.object({ schema: aiWorkspaceProposalSchema }),
    abortSignal: AbortSignal.timeout(30_000),
    maxRetries: 1,
    system: buildPlannerInstructions(input.catalog),
    prompt: [
      `Today is ${new Date().toISOString().slice(0, 10)}.`,
      `Maximum rows: ${Math.min(200, Math.max(1, input.limit))}.`,
      `User request: ${input.prompt}`,
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
        synonyms: field.synonyms,
        filterOperators: field.filterOperators,
        groupable: field.groupable,
        sortable: field.sortable,
        allowedValues: field.allowedValues,
        valueSets: field.valueSets,
      })),
      metrics: entity.metrics,
    })),
    relationships: catalog.relationships,
  };

  return [
    "You are the semantic workspace planner for MorphUI.",
    "Understand the user's business question and presentation preference, then return only the typed plan.",
    "Use only entities, fields, operators, values, metrics, and relationships supplied in the approved catalogue.",
    "Never create SQL, joins, fields, filter values, permissions, or calculations outside the catalogue.",
    "The UI composition must fit the request instead of defaulting every request to the same dashboard.",
    "Use a records table for record-level lists, a grouped-summary table for grouped table requests, charts for comparisons or trends, metrics for headline totals, and multiple blocks only when a dashboard is requested or clearly useful.",
    "Honor explicit inclusion and exclusion instructions such as only, without, omit, concise, detailed, chart, table, cards, or dashboard.",
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
  if (blocks.includes("chart") && (!groupBy || proposal.visualization === "table")) {
    throw new Error("AI chart plans require an approved grouping and chart visualization.");
  }
  if (proposal.presentation.tableLayout === "grouped_summary" && !groupBy) {
    throw new Error("AI grouped tables require an approved grouping field.");
  }

  const requiredFields = [
    ...proposal.fields,
    ...(groupBy ? [groupBy] : []),
    ...metrics.flatMap((metric) => metric.field ?? []),
  ];
  const fields = Array.from(new Set(requiredFields));
  if (!fields.length || fields.length > 30 || fields.some((field) => !fieldMap.has(field))) {
    throw new Error("AI selected fields outside the approved catalogue.");
  }

  const days = inferDays(filters, entity);
  const minimumAmount = inferMinimumAmount(filters, entity);

  return {
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

const plannerFailureMessages = {
  not_configured:'AI planning has not been configured for this connection.',
  authentication:'The AI provider rejected its credentials. Ask an administrator to check the server configuration.',
  quota:'The AI provider quota or rate limit was reached. Retry later.',
  timeout:'The AI provider took too long to respond. You can retry the request.',
  invalid_plan:'The AI response did not pass catalogue validation. Review the basic interpretation before using it.',
  unavailable:'The AI provider is temporarily unavailable. You can retry shortly.',
} as const;
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
