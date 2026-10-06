import { z } from "zod";
import {
  buildRenewalWorkspaceResponse,
  createDemoRenewalRecords,
  type RenewalRecord,
} from "./renewals";
import type {
  GatewayAllowResponse,
  GatewayCatalogResponse,
  GatewayQueryPlan,
} from "@/lib/gateway/contract";
import {
  insuranceSemanticCatalog,
  type SemanticCatalog,
  type SemanticEntity,
  type SemanticMetric,
} from "@/lib/catalog/semantic";

export const dynamicWorkspaceRequestSchema = z
  .object({
    prompt: z.string().trim().min(8).max(500),
    limit: z.number().int().min(1).max(200).default(200),
  })
  .strict();

export type WorkspaceIntent =
  | "renewals"
  | "claims"
  | "endorsements"
  | "policies";
export type WorkspaceSourceMode = "client_gateway" | "secure_demo";
export type TableCellFormat =
  | "text"
  | "id"
  | "currency"
  | "date"
  | "person"
  | "badge";

export type WorkspaceVisualization = "bar" | "donut" | "line" | "table";
export type WorkspaceBlockType = "metrics" | "filters" | "chart" | "table";
export type WorkspacePresentationMode =
  | "auto"
  | "chart_only"
  | "dashboard"
  | "metrics_only"
  | "table_only";

export type WorkspacePresentation = {
  mode: WorkspacePresentationMode;
  blocks: WorkspaceBlockType[];
  tableLayout: "grouped_summary" | "records";
};

export type WorkspaceSpec = {
  title: string;
  description: string;
  source: string;
  generatedIn: string;
  blocks: Array<
    | {
        type: "metrics";
        items: Array<{
          label: string;
          value: string;
          delta: string;
          tone: "lime" | "orange" | "blue";
        }>;
      }
    | {
        type: "trend";
        title: string;
        subtitle: string;
        values: number[];
        total: string;
        labels: [string, string, string];
        axisLabels: [string, string, string];
      }
    | {
        type: "filters";
        items: Array<{ label: string; value: string }>;
      }
    | {
        type: "chart";
        variant: Exclude<WorkspaceVisualization, "table">;
        title: string;
        subtitle: string;
        valueFormat: "currency" | "number" | "percentage";
        items: Array<{ label: string; value: number }>;
      }
    | {
        type: "table";
        title: string;
        columns: Array<{
          key: string;
          label: string;
          format?: TableCellFormat;
        }>;
        rows: Array<Record<string, string | number | null>>;
        totalRows: number;
        emptyMessage: string;
      }
  >;
};

export type WorkspaceQueryPlan = GatewayQueryPlan;

export type DynamicWorkspaceResponse = {
  intent: WorkspaceIntent;
  interpretation: string;
  sourceMode: WorkspaceSourceMode;
  spec: WorkspaceSpec;
  queryPlan: WorkspaceQueryPlan;
  presentation?: WorkspacePresentation;
  planner?: {
    mode: "ai" | "deterministic_fallback";
    model: string | null;
    validated: true;
    reason: "ai_plan" | "ai_not_configured" | "ai_plan_rejected";
    failureCode?:'not_configured'|'authentication'|'quota'|'timeout'|'invalid_plan'|'unavailable';
    message?:string;
  };
  safety: {
    readOnly: true;
    rawSqlAccepted: false;
    fieldsAccessed: number;
    permittedFields: number;
    sensitiveData: "masked";
    maximumRows: number;
    returnedRows: number;
  };
  gateway?: {
    decision: "allow";
    decisionId: string;
    connectorId: string;
    policyVersion: string;
    catalogVersion: string;
    enforcedBy: "client_gateway" | "secure_demo_gateway";
    identityVerified: boolean;
    identityProvider: "oidc" | "secure_demo";
    identityIssuer: string;
    identityExpiresAt: string;
    maskedFields: string[];
  };
};

export type WorkspacePlan = {
  intent: WorkspaceIntent;
  title: string;
  interpretation: string;
  catalogVersion: string;
  entity: SemanticEntity["entity"];
  source: string;
  fields: string[];
  filters: GatewayQueryPlan["filters"];
  groupBy?: string;
  orderBy: GatewayQueryPlan["orderBy"];
  metrics: SemanticMetric[];
  visualization: WorkspaceVisualization;
  presentation: WorkspacePresentation;
  days: number;
  minimumAmount: number;
  limit: number;
};

export type PolicyWorkspaceRow = {
  policyNumber: string;
  customerName: string;
  product: string;
  branch: string;
  relationshipManager: string;
  startDate: string;
  expiryDate: string;
  premium: number;
  status: string;
};

export type ClaimWorkspaceRow = {
  claimNumber: string;
  policyNumber: string;
  customerName: string;
  branch: string;
  intimationDate: string;
  claimedAmount: number;
  approvedAmount: number | null;
  status: string;
  cause: string;
};

export type EndorsementWorkspaceRow = {
  endorsementNumber: string;
  policyNumber: string;
  customerName: string;
  type: string;
  status: string;
  requestedAt: string;
  effectiveDate: string;
  premiumDelta: number;
  branch: string;
};

export class UnsupportedWorkspaceRequestError extends Error {
  readonly suggestions = [
    "Show motor policies expiring in the next 15 days above ₹20,000",
    "Show high-value claims reported this month by branch",
    "Show pending endorsements grouped by type",
    "Show the active policy portfolio by product",
  ];

  constructor(message="Ask about policies, claims, renewals, or endorsements.") {
    super(message);
  }
}

export function planWorkspaceRequest(
  prompt: string,
  catalogOrLimit: Pick<GatewayCatalogResponse, "catalogVersion" | "entities" | "relationships"> | SemanticCatalog | number = insuranceSemanticCatalog,
  requestedLimit = 200,
): WorkspacePlan {
  const normalized = prompt.toLowerCase();
  const catalog =
    typeof catalogOrLimit === "number" ? insuranceSemanticCatalog : catalogOrLimit;
  const limit = clamp(
    typeof catalogOrLimit === "number" ? catalogOrLimit : requestedLimit,
    1,
    200,
  );
  const days = clamp(extractNumber(normalized, /(?:next|within)\s+(\d+)\s+days?/, 15), 1, 90);
  const minimumAmount = clamp(
    /(?:more than|over)\s+\d+\s+days?/.test(normalized)
      ? normalized.includes("high-value") || normalized.includes("high value")
        ? 50_000
        : 0
      :
    extractNumber(
      normalized.replaceAll(",", ""),
      /(?:above|over|greater than|more than)\s*(?:₹|rs\.?|inr)?\s*(\d+)/,
      normalized.includes("high-value") || normalized.includes("high value")
        ? 50_000
        : 0,
    ),
    0,
    10_000_000,
  );

  const renewalIntent = /(renew|expir|due polic)/.test(normalized);
  const ranked = catalog.entities
    .map((entity) => ({
      entity,
      score: [entity.entity, entity.label, ...entity.synonyms]
        .filter((term) => normalized.includes(term.toLowerCase()))
        .reduce((score, term) => score + Math.max(1, term.length), 0),
    }))
    .sort((first, second) => second.score - first.score);
  const entity = renewalIntent
    ? catalog.entities.find((item) => item.entity === "policies")
    : ranked[0]?.score
      ? ranked[0].entity
      : undefined;
  if (!entity) throw new UnsupportedWorkspaceRequestError();

  const intent: WorkspaceIntent = renewalIntent
    ? "renewals"
    : entity.entity;
  const presentationMode = detectPresentationMode(normalized);
  const groupBy =
    selectGroupBy(normalized, entity) ??
    (renewalIntent && entity.fields.some((field) => field.name === "relationship_manager")
      ? "relationship_manager"
      : presentationMode === "chart_only"
        ? entity.fields.find((field) => field.name === entity.statusField && field.groupable)?.name ??
          entity.fields.find((field) => field.groupable)?.name
        : undefined);
  const filters = createCatalogFilters({
    normalized,
    entity,
    intent,
    days,
    minimumAmount,
  });
  const orderBy = createCatalogSorting(normalized, entity);
  const selectedFields = Array.from(
    new Set([
      ...entity.defaultFields,
      ...(groupBy ? [groupBy] : []),
      ...entity.metrics.flatMap((metric) => metric.field ?? []),
    ]),
  ).filter((name) => entity.fields.some((field) => field.name === name));
  const visualization: WorkspaceVisualization = presentationMode === "table_only"
    ? "table"
    : /\b(donut|pie chart|share|distribution|breakdown)\b/.test(normalized)
    ? "donut"
    : /\b(line chart|trend|over time|daily|weekly|monthly)\b/.test(normalized)
      ? "line"
      : groupBy
        ? "bar"
        : "table";
  const presentation = createPresentation(
    normalized,
    presentationMode,
    visualization,
    Boolean(groupBy),
  );
  const dataInterpretation = renewalIntent
    ? `Policies expiring within ${days} days${minimumAmount ? ` above ${formatCurrency(minimumAmount)}` : ""}`
    : `${entity.label}${minimumAmount ? ` above ${formatCurrency(minimumAmount)}` : ""}${groupBy ? ` grouped by ${humanize(groupBy)}` : ""}`;
  const interpretation = `${dataInterpretation} · ${presentationLabel(presentation.mode)}`;

  return {
    intent,
    title: intent === "renewals" ? `Renewals — next ${days} days` : entity.label,
    interpretation,
    catalogVersion: catalog.catalogVersion,
    entity: entity.entity,
    source: entity.source,
    fields: selectedFields.slice(0, 30),
    filters,
    groupBy,
    orderBy,
    metrics: entity.metrics,
    visualization,
    presentation,
    days,
    minimumAmount,
    limit: Math.min(limit, entity.maximumRows),
  };
}

export function createWorkspaceQueryPlan(
  plan: WorkspacePlan,
): GatewayQueryPlan {
  return {
    source: plan.source,
    catalogVersion: plan.catalogVersion,
    operation: "select",
    entity: plan.entity,
    fields: plan.fields,
    filters: plan.filters,
    ...(plan.groupBy ? { groupBy: plan.groupBy } : {}),
    orderBy: plan.orderBy,
    rowLimit: plan.limit,
  };
}

export function applyGatewayDecision(
  response: Omit<DynamicWorkspaceResponse, "gateway"> | DynamicWorkspaceResponse,
  decision: GatewayAllowResponse,
  sourceMode: WorkspaceSourceMode,
): DynamicWorkspaceResponse {
  return {
    ...response,
    sourceMode,
    spec: {
      ...response.spec,
      source:
        sourceMode === "client_gateway"
          ? "Client-hosted Morph Gateway"
          : "Secure demonstration Gateway",
    },
    queryPlan: decision.executedPlan,
    safety: {
      ...response.safety,
      fieldsAccessed: decision.executedPlan.fields.length,
      permittedFields: decision.executedPlan.fields.length,
      maximumRows: decision.maximumRows,
      returnedRows: decision.returnedRows,
    },
    gateway: {
      decision: "allow",
      decisionId: decision.decisionId,
      connectorId: decision.connectorId,
      policyVersion: decision.policyVersion,
      catalogVersion: decision.catalogVersion,
      enforcedBy:
        sourceMode === "client_gateway"
          ? "client_gateway"
          : "secure_demo_gateway",
      identityVerified: decision.identityVerified,
      identityProvider: decision.identityProvider,
      identityIssuer: decision.identityIssuer,
      identityExpiresAt: decision.identityExpiresAt,
      maskedFields: decision.maskedFields,
    },
  };
}

export function buildCatalogDrivenWorkspace(options: {
  plan: WorkspacePlan;
  entity: SemanticEntity;
  records: Array<Record<string, string | number | null>>;
  sourceMode: WorkspaceSourceMode;
  generatedInMs: number;
}): DynamicWorkspaceResponse {
  const { plan, entity } = options;
  const records = options.records.slice(0, plan.limit);
  const fieldMap = new Map(entity.fields.map((field) => [field.name, field]));
  const metricItems = plan.metrics.slice(0, 3).map((metric, index) => {
    const values = metric.field
      ? records.map((row) => row[metric.field!]).filter((value): value is number => typeof value === "number")
      : [];
    const rawValue = metric.operation === "count"
      ? records.length
      : metric.operation === "average"
        ? values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
        : values.reduce((total, value) => total + value, 0);
    return {
      label: metric.label,
      value: formatMetric(rawValue, metric.format),
      delta: metric.description,
      tone: (["lime", "orange", "blue"] as const)[index % 3],
    };
  });
  const groupField = plan.groupBy ? fieldMap.get(plan.groupBy) : undefined;
  const amountField = entity.amountField ? fieldMap.get(entity.amountField) : undefined;
  const grouped = groupField
    ? groupRecordValues(records, groupField.name, amountField?.name)
    : [];
  const chartItems = grouped.slice(0, 10);
  const filterItems = plan.filters.map((filter) => ({
    label: fieldMap.get(filter.field)?.label ?? humanize(filter.field),
    value: `${humanize(filter.operator)} · ${formatFilterValue(filter.value, fieldMap.get(filter.field)?.format)}`,
  }));
  const columns = plan.fields
    .map((key) => {
      const field = fieldMap.get(key);
      return field
        ? { key, label: field.label, format: toTableFormat(field.format) }
        : null;
    })
    .filter((column): column is NonNullable<typeof column> => Boolean(column));
  const groupedTable =
    plan.presentation.tableLayout === "grouped_summary" && groupField
      ? groupRecordStats(records, groupField.name, amountField?.name)
      : null;
  const tableBlock: Extract<WorkspaceSpec["blocks"][number], { type: "table" }> = groupedTable
    ? {
        type: "table",
        title: `${entity.label} grouped by ${groupField?.label ?? "category"}`,
        columns: [
          {
            key: "group",
            label: groupField?.label ?? "Group",
            format: "text",
          },
          { key: "record_count", label: "Records", format: "text" },
          ...(amountField
            ? [
                { key: "total_value", label: `Total ${amountField.label}`, format: "currency" as const },
                { key: "average_value", label: `Average ${amountField.label}`, format: "currency" as const },
              ]
            : []),
        ],
        rows: groupedTable,
        totalRows: groupedTable.length,
        emptyMessage: `No ${entity.label.toLowerCase()} match this request. Adjust a filter and try again.`,
      }
    : {
        type: "table",
        title: `${entity.label} records`,
        columns,
        rows: records,
        totalRows: records.length,
        emptyMessage: `No ${entity.label.toLowerCase()} match this request. Adjust a filter and try again.`,
      };
  const blocks: WorkspaceSpec["blocks"] = [];
  if (plan.presentation.blocks.includes("metrics")) {
    blocks.push({ type: "metrics", items: metricItems });
  }
  if (plan.presentation.blocks.includes("filters") && filterItems.length) {
    blocks.push({ type: "filters", items: filterItems });
  }
  if (plan.presentation.blocks.includes("chart")) {
    blocks.push({
      type: "chart",
      variant: plan.visualization === "table" ? "bar" : plan.visualization,
      title: `${amountField ? amountField.label : "Records"} by ${groupField?.label ?? "category"}`,
      subtitle: `Built from ${entity.label.toLowerCase()} catalogue metadata`,
      valueFormat: amountField?.format === "currency" ? "currency" : "number",
      items: chartItems,
    });
  }
  if (plan.presentation.blocks.includes("table")) {
    blocks.push(tableBlock);
  }

  return {
    intent: plan.intent,
    interpretation: plan.interpretation,
    sourceMode: options.sourceMode,
    spec: {
      title: plan.title,
      description: plan.interpretation,
      source: options.sourceMode === "client_gateway" ? "Client-hosted Morph Gateway" : "Secure demonstration Gateway",
      generatedIn: `${Math.max(1, Math.round(options.generatedInMs))}ms`,
      blocks,
    },
    queryPlan: createWorkspaceQueryPlan(plan),
    presentation: plan.presentation,
    safety: {
      readOnly: true,
      rawSqlAccepted: false,
      fieldsAccessed: plan.fields.length,
      permittedFields: entity.fields.length,
      sensitiveData: "masked",
      maximumRows: entity.maximumRows,
      returnedRows: records.length,
    },
  };
}

export function buildRenewalDynamicWorkspace(options: {
  plan: WorkspacePlan;
  records: RenewalRecord[];
  sourceMode: WorkspaceSourceMode;
  generatedInMs: number;
}): DynamicWorkspaceResponse {
  const renewal = buildRenewalWorkspaceResponse({
    records: options.records,
    filters: {
      days: options.plan.days,
      minimumPremium: options.plan.minimumAmount,
      limit: options.plan.limit,
    },
    sourceMode: options.sourceMode,
    generatedInMs: options.generatedInMs,
  });
  const values = normalizeValues(renewal.trend.map((item) => item.premium));

  return {
    intent: "renewals",
    interpretation: options.plan.interpretation,
    sourceMode: options.sourceMode,
    spec: {
      title: renewal.workspace.title,
      description: renewal.workspace.description,
      source: renewal.workspace.sourceLabel,
      generatedIn: `${renewal.workspace.generatedInMs}ms`,
      blocks: [
        {
          type: "metrics",
          items: [
            {
              label: "Renewals due",
              value: String(renewal.summary.renewalsDue),
              delta: `${renewal.groups.length} relationship managers`,
              tone: "lime",
            },
            {
              label: "Premium at risk",
              value: formatCompactCurrency(renewal.summary.premiumAtRisk),
              delta: `Across ${renewal.summary.accounts} accounts`,
              tone: "orange",
            },
            {
              label: "High priority",
              value: String(renewal.summary.highPriority),
              delta: "Needs action first",
              tone: "blue",
            },
          ],
        },
        {
          type: "trend",
          title: "Renewal value by day",
          subtitle: `${formatDate(renewal.trend[0]?.date)} — ${formatDate(renewal.trend.at(-1)?.date)}`,
          values,
          total: formatCompactCurrency(renewal.summary.premiumAtRisk),
          labels: trendLabels(renewal.trend.map((item) => item.date)),
          axisLabels: ["High", "Mid", "Low"],
        },
        {
          type: "table",
          title: "Policies requiring attention",
          totalRows: renewal.rows.length,
          emptyMessage:
            "No renewals match this request. Try a longer date range or lower premium.",
          columns: [
            { key: "policy", label: "Policy", format: "id" },
            { key: "customer", label: "Customer" },
            { key: "expiry", label: "Expiry", format: "date" },
            { key: "premium", label: "Premium", format: "currency" },
            { key: "manager", label: "RM", format: "person" },
            { key: "priority", label: "Priority", format: "badge" },
          ],
          rows: renewal.rows.slice(0, 8).map((row) => ({
            policy: row.policyNumber,
            customer: row.customerName,
            expiry: row.expiryDate,
            premium: row.premium,
            manager: row.relationshipManager,
            priority: row.priority,
          })),
        },
      ],
    },
    queryPlan: createWorkspaceQueryPlan(options.plan),
    safety: renewal.safety,
  };
}

export function buildClaimsDynamicWorkspace(options: {
  plan: WorkspacePlan;
  records: ClaimWorkspaceRow[];
  sourceMode: WorkspaceSourceMode;
  generatedInMs: number;
}): DynamicWorkspaceResponse {
  const records = options.records.slice(0, options.plan.limit);
  const totalClaimed = sumBy(records, (record) => record.claimedAmount);
  const totalApproved = sumBy(records, (record) => record.approvedAmount ?? 0);
  const branchGroups = groupAmounts(
    records,
    (record) => record.branch,
    (record) => record.claimedAmount,
  );

  return createResponse({
    intent: "claims",
    interpretation: options.plan.interpretation,
    sourceMode: options.sourceMode,
    generatedInMs: options.generatedInMs,
    title: "High-value claims — this month",
    description: "Claim exposure grouped by branch with settlement progress",
    metrics: [
      ["Claims reported", String(records.length), `${branchGroups.length} branches`, "lime"],
      ["Claim exposure", formatCompactCurrency(totalClaimed), "Total amount claimed", "orange"],
      ["Approved so far", formatCompactCurrency(totalApproved), `${approvalRate(totalApproved, totalClaimed)}% of exposure`, "blue"],
    ],
    chart: {
      title: "Claim exposure by branch",
      subtitle: "Current month",
      values: normalizeValues(branchGroups.map((group) => group.value)),
      total: formatCompactCurrency(totalClaimed),
      labels: categoricalLabels(branchGroups.map((group) => group.label)),
      axisLabels: ["High", "Mid", "Low"],
    },
    table: {
      title: "Claims requiring attention",
      totalRows: records.length,
      emptyMessage:
        "No claims match this request. Try lowering the claimed amount.",
      columns: [
        { key: "claim", label: "Claim", format: "id" },
        { key: "customer", label: "Customer" },
        { key: "branch", label: "Branch" },
        { key: "reported", label: "Reported", format: "date" },
        { key: "amount", label: "Claimed", format: "currency" },
        { key: "status", label: "Status", format: "badge" },
      ],
      rows: records.slice(0, 8).map((record) => ({
        claim: record.claimNumber,
        customer: record.customerName,
        branch: record.branch,
        reported: record.intimationDate,
        amount: record.claimedAmount,
        status: humanize(record.status),
      })),
    },
    queryPlan: {
      source: "claims_read_replica",
      catalogVersion: options.plan.catalogVersion,
      operation: "select",
      entity: "claims",
      fields: ["claim_number", "policy_number", "customer_name", "branch", "intimation_date", "claimed_amount", "approved_amount", "status"],
      filters: [
        { field: "intimation_date", operator: "current_month", value: "current_month" },
        { field: "claimed_amount", operator: "greater_than", value: options.plan.minimumAmount },
      ],
      groupBy: "branch",
      orderBy: options.plan.orderBy,
      rowLimit: options.plan.limit,
    },
    returnedRows: records.length,
    fieldsAccessed: 8,
  });
}

export function buildEndorsementDynamicWorkspace(options: {
  plan: WorkspacePlan;
  records: EndorsementWorkspaceRow[];
  sourceMode: WorkspaceSourceMode;
  generatedInMs: number;
}): DynamicWorkspaceResponse {
  const records = options.records.slice(0, options.plan.limit);
  const premiumImpact = sumBy(records, (record) => record.premiumDelta);
  const typeGroups = groupAmounts(records, (record) => humanize(record.type), () => 1);
  const documentsPending = records.filter(
    (record) => record.status === "documents_pending",
  ).length;

  return createResponse({
    intent: "endorsements",
    interpretation: options.plan.interpretation,
    sourceMode: options.sourceMode,
    generatedInMs: options.generatedInMs,
    title: "Pending policy endorsements",
    description: "Open service requests grouped by endorsement type",
    metrics: [
      ["Open requests", String(records.length), `${typeGroups.length} request types`, "lime"],
      ["Documents pending", String(documentsPending), "Customer follow-up needed", "orange"],
      ["Premium impact", formatCompactCurrency(premiumImpact), "Across open requests", "blue"],
    ],
    chart: {
      title: "Requests by endorsement type",
      subtitle: "Current open workload",
      values: normalizeValues(typeGroups.map((group) => group.value)),
      total: String(records.length),
      labels: categoricalLabels(typeGroups.map((group) => group.label)),
      axisLabels: ["Most", "Mid", "Least"],
    },
    table: {
      title: "Endorsement work queue",
      totalRows: records.length,
      emptyMessage: "There are no open endorsements in the current selection.",
      columns: [
        { key: "endorsement", label: "Endorsement", format: "id" },
        { key: "customer", label: "Customer" },
        { key: "type", label: "Type" },
        { key: "requested", label: "Requested", format: "date" },
        { key: "impact", label: "Premium Δ", format: "currency" },
        { key: "status", label: "Status", format: "badge" },
      ],
      rows: records.slice(0, 8).map((record) => ({
        endorsement: record.endorsementNumber,
        customer: record.customerName,
        type: humanize(record.type),
        requested: record.requestedAt,
        impact: record.premiumDelta,
        status: humanize(record.status),
      })),
    },
    queryPlan: {
      source: "endorsements_read_replica",
      catalogVersion: options.plan.catalogVersion,
      operation: "select",
      entity: "endorsements",
      fields: ["endorsement_number", "policy_number", "customer_name", "type", "status", "requested_at", "premium_delta", "branch"],
      filters: [{ field: "status", operator: "in", value: "requested,documents_pending,under_review,approved" }],
      groupBy: "type",
      orderBy: options.plan.orderBy,
      rowLimit: options.plan.limit,
    },
    returnedRows: records.length,
    fieldsAccessed: 8,
  });
}

export function buildPolicyDynamicWorkspace(options: {
  plan: WorkspacePlan;
  records: PolicyWorkspaceRow[];
  sourceMode: WorkspaceSourceMode;
  generatedInMs: number;
}): DynamicWorkspaceResponse {
  const records = options.records.slice(0, options.plan.limit);
  const totalPremium = sumBy(records, (record) => record.premium);
  const productGroups = groupAmounts(
    records,
    (record) => shortProductName(record.product),
    (record) => record.premium,
  );
  const branches = new Set(records.map((record) => record.branch)).size;

  return createResponse({
    intent: "policies",
    interpretation: options.plan.interpretation,
    sourceMode: options.sourceMode,
    generatedInMs: options.generatedInMs,
    title: "Active motor policy portfolio",
    description: "Premium distribution by product and operating branch",
    metrics: [
      ["Active policies", String(records.length), `${branches} operating branches`, "lime"],
      ["Written premium", formatCompactCurrency(totalPremium), "Current active selection", "orange"],
      ["Avg. premium", formatCompactCurrency(records.length ? totalPremium / records.length : 0), "Per active policy", "blue"],
    ],
    chart: {
      title: "Premium by product",
      subtitle: "Active motor portfolio",
      values: normalizeValues(productGroups.map((group) => group.value)),
      total: formatCompactCurrency(totalPremium),
      labels: categoricalLabels(productGroups.map((group) => group.label)),
      axisLabels: ["High", "Mid", "Low"],
    },
    table: {
      title: "Active policy portfolio",
      totalRows: records.length,
      emptyMessage:
        "No policies match this request. Try lowering the premium threshold.",
      columns: [
        { key: "policy", label: "Policy", format: "id" },
        { key: "customer", label: "Customer" },
        { key: "product", label: "Product" },
        { key: "expiry", label: "Expiry", format: "date" },
        { key: "premium", label: "Premium", format: "currency" },
        { key: "manager", label: "RM", format: "person" },
      ],
      rows: records.slice(0, 8).map((record) => ({
        policy: record.policyNumber,
        customer: record.customerName,
        product: shortProductName(record.product),
        expiry: record.expiryDate,
        premium: record.premium,
        manager: record.relationshipManager,
      })),
    },
    queryPlan: {
      source: "policies_read_replica",
      catalogVersion: options.plan.catalogVersion,
      operation: "select",
      entity: "policies",
      fields: ["policy_number", "customer_name", "product", "branch", "relationship_manager", "expiry_date", "total_premium", "status"],
      filters: [
        { field: "status", operator: "equals", value: "active" },
        { field: "total_premium", operator: "greater_than", value: options.plan.minimumAmount },
      ],
      groupBy: "product",
      orderBy: options.plan.orderBy,
      rowLimit: options.plan.limit,
    },
    returnedRows: records.length,
    fieldsAccessed: 8,
  });
}

export function createDemoRows(intent: WorkspaceIntent, plan: WorkspacePlan) {
  if (intent === "renewals") {
    return createDemoRenewalRecords({
      days: plan.days,
      minimumPremium: plan.minimumAmount,
      limit: plan.limit,
    });
  }

  const today = new Date();
  if (intent === "claims") {
    return Array.from({ length: 18 }, (_, index): ClaimWorkspaceRow => ({
      claimNumber: `CLM-DEMO-${String(index + 1).padStart(4, "0")}`,
      policyNumber: `MTR-DEMO-${String(index + 31).padStart(5, "0")}`,
      customerName: demoCustomers[index % demoCustomers.length],
      branch: demoBranches[index % demoBranches.length],
      intimationDate: toDateOnly(addDays(today, -(index % 25))),
      claimedAmount: 42_000 + ((index * 31_700) % 310_000),
      approvedAmount: index % 3 === 0 ? null : 31_000 + ((index * 21_300) % 210_000),
      status: ["intimated", "documents_pending", "under_assessment", "approved", "settled"][index % 5],
      cause: ["Road collision", "Flood damage", "Glass damage", "Theft"][index % 4],
    })).filter((record) => record.claimedAmount > plan.minimumAmount);
  }
  if (intent === "endorsements") {
    return Array.from({ length: 16 }, (_, index): EndorsementWorkspaceRow => ({
      endorsementNumber: `END-DEMO-${String(index + 1).padStart(4, "0")}`,
      policyNumber: `MTR-DEMO-${String(index + 51).padStart(5, "0")}`,
      customerName: demoCustomers[index % demoCustomers.length],
      type: ["address_change", "vehicle_transfer", "hypothecation_add", "coverage_change"][index % 4],
      status: ["requested", "documents_pending", "under_review", "approved"][index % 4],
      requestedAt: toDateOnly(addDays(today, -(index + 1))),
      effectiveDate: toDateOnly(addDays(today, index % 6)),
      premiumDelta: index % 4 === 3 ? 1_500 + index * 420 : 0,
      branch: demoBranches[index % demoBranches.length],
    }));
  }
  return Array.from({ length: 20 }, (_, index): PolicyWorkspaceRow => ({
    policyNumber: `MTR-DEMO-${String(index + 71).padStart(5, "0")}`,
    customerName: demoCustomers[index % demoCustomers.length],
    product: demoProducts[index % demoProducts.length],
    branch: demoBranches[index % demoBranches.length],
    relationshipManager: demoManagers[index % demoManagers.length],
    startDate: toDateOnly(addDays(today, -300 + index)),
    expiryDate: toDateOnly(addDays(today, 65 + index * 3)),
    premium: 18_000 + ((index * 13_700) % 102_000),
    status: "active",
  })).filter((record) => record.premium > plan.minimumAmount);
}

const demoCustomers = ["Aarav Logistics", "Meridian Foods", "Northstar Retail", "Vega Components", "Ananta Mobility", "Bluepeak Warehousing"];
const demoBranches = ["Hyderabad Central", "Bengaluru Central", "Mumbai Central", "Chennai Central"];
const demoManagers = ["Neha Rao", "Arjun Mehta", "Kabir Shah", "Isha Nair"];
const demoProducts = ["Private Car Comprehensive", "Two Wheeler Comprehensive", "Commercial Vehicle Comprehensive"];

function createResponse(options: {
  intent: WorkspaceIntent;
  interpretation: string;
  sourceMode: WorkspaceSourceMode;
  generatedInMs: number;
  title: string;
  description: string;
  metrics: Array<[string, string, string, "lime" | "orange" | "blue"]>;
  chart: Omit<
    Extract<WorkspaceSpec["blocks"][number], { type: "trend" }>,
    "type"
  >;
  table: Omit<
    Extract<WorkspaceSpec["blocks"][number], { type: "table" }>,
    "type"
  >;
  queryPlan: WorkspaceQueryPlan;
  returnedRows: number;
  fieldsAccessed: number;
}): DynamicWorkspaceResponse {
  return {
    intent: options.intent,
    interpretation: options.interpretation,
    sourceMode: options.sourceMode,
    spec: {
      title: options.title,
      description: options.description,
      source:
        options.sourceMode === "client_gateway"
          ? "Client-hosted Morph Gateway"
          : "Secure demonstration Gateway",
      generatedIn: `${Math.max(1, Math.round(options.generatedInMs))}ms`,
      blocks: [
        {
          type: "metrics",
          items: options.metrics.map(([label, value, delta, tone]) => ({ label, value, delta, tone })),
        },
        { type: "trend", ...options.chart },
        { type: "table", ...options.table },
      ],
    },
    queryPlan: options.queryPlan,
    safety: {
      readOnly: true,
      rawSqlAccepted: false,
      fieldsAccessed: options.fieldsAccessed,
      permittedFields: options.fieldsAccessed,
      sensitiveData: "masked",
      maximumRows: 200,
      returnedRows: options.returnedRows,
    },
  };
}

function groupAmounts<T>(records: T[], label: (record: T) => string, value: (record: T) => number) {
  const groups = new Map<string, number>();
  for (const record of records) {
    const key = label(record);
    groups.set(key, (groups.get(key) ?? 0) + value(record));
  }
  return Array.from(groups, ([groupLabel, groupValue]) => ({ label: groupLabel, value: groupValue })).sort(
    (first, second) => second.value - first.value,
  );
}

function sumBy<T>(records: T[], value: (record: T) => number) {
  return records.reduce((total, record) => total + value(record), 0);
}

function normalizeValues(values: number[]) {
  const maximum = Math.max(...values, 1);
  return values.length ? values.map((value) => Math.round(8 + (value / maximum) * 84)) : [8, 8, 8];
}

function trendLabels(labels: string[]): [string, string, string] {
  if (!labels.length) return ["Start", "Middle", "End"];
  return [formatDate(labels[0]), formatDate(labels[Math.floor(labels.length / 2)]), formatDate(labels.at(-1))];
}

function categoricalLabels(labels: string[]): [string, string, string] {
  if (!labels.length) return ["No data", "No data", "No data"];
  return [labels[0], labels[Math.floor(labels.length / 2)], labels.at(-1) ?? labels[0]];
}

function approvalRate(approved: number, claimed: number) {
  return claimed ? Math.round((approved / claimed) * 100) : 0;
}

function extractNumber(value: string, pattern: RegExp, fallback: number) {
  const match = value.match(pattern);
  return match ? Number(match[1]) : fallback;
}

function selectGroupBy(normalized: string, entity: SemanticEntity) {
  const groupable = entity.fields.filter((field) => field.groupable);
  const direct = groupable.find((field) =>
    [field.name, field.label, ...field.synonyms].some((term) =>
      normalized.includes(term.toLowerCase()),
    ),
  );
  if (/\b(group|breakdown|distribution|compare| by )\b/.test(normalized)) {
    return direct?.name ?? groupable[0]?.name;
  }
  return direct?.name;
}

function detectPresentationMode(
  normalized: string,
): WorkspacePresentationMode {
  if (
    /\b(?:normal\s+)?table\s+only\b/.test(normalized) ||
    /\bonly\s+(?:show\s+|use\s+|in\s+)?(?:a\s+)?(?:normal\s+)?table\b/.test(normalized) ||
    /\bjust\s+(?:show\s+)?(?:a\s+)?(?:normal\s+)?table\b/.test(normalized) ||
    /\b(?:show|display|render|present)\s+(?:it\s+)?(?:as|in)\s+(?:a\s+)?(?:normal\s+)?table\b/.test(normalized) ||
    /\b(?:as|in)\s+(?:a\s+)?(?:normal\s+)?table\b/.test(normalized)
  ) {
    return "table_only";
  }
  if (
    /\b(?:chart|graph|visuali[sz]ation)\s+only\b/.test(normalized) ||
    /\bonly\s+(?:show\s+)?(?:a\s+)?(?:chart|graph|visuali[sz]ation)\b/.test(normalized) ||
    /\b(?:show|display|render|present)\s+(?:it\s+)?as\s+(?:a\s+)?(?:bar|line|pie|donut)?\s*(?:chart|graph|visuali[sz]ation)\b/.test(normalized) ||
    /\bas\s+(?:a\s+)?(?:bar|line|pie|donut)?\s*(?:chart|graph|visuali[sz]ation)\b/.test(normalized)
  ) {
    return "chart_only";
  }
  if (
    /\b(?:kpi|kpis|metric|metrics|summary)\s+only\b/.test(normalized) ||
    /\bonly\s+(?:show\s+)?(?:kpi|kpis|metric|metrics|summary)\b/.test(normalized)
  ) {
    return "metrics_only";
  }
  if (/\b(?:dashboard|full workspace|complete workspace)\b/.test(normalized)) {
    return "dashboard";
  }
  return "auto";
}

function createPresentation(
  normalized: string,
  mode: WorkspacePresentationMode,
  visualization: WorkspaceVisualization,
  hasGrouping: boolean,
): WorkspacePresentation {
  if (mode === "table_only") {
    return {
      mode,
      blocks: ["table"],
      tableLayout: hasGrouping ? "grouped_summary" : "records",
    };
  }
  if (mode === "chart_only") {
    return { mode, blocks: ["chart"], tableLayout: "records" };
  }
  if (mode === "metrics_only") {
    return { mode, blocks: ["metrics"], tableLayout: "records" };
  }

  const blocks: WorkspaceBlockType[] = ["metrics"];
  if (!/\b(?:hide|without|no)\s+filters?\b/.test(normalized)) {
    blocks.push("filters");
  }
  if (
    visualization !== "table" &&
    !/\b(?:hide|without|no)\s+(?:chart|graph|visuali[sz]ation)\b/.test(normalized)
  ) {
    blocks.push("chart");
  }
  if (!/\b(?:hide|without|no)\s+table\b/.test(normalized)) {
    blocks.push("table");
  }
  return { mode, blocks, tableLayout: "records" };
}

function presentationLabel(mode: WorkspacePresentationMode) {
  if (mode === "table_only") return "Table only";
  if (mode === "chart_only") return "Chart only";
  if (mode === "metrics_only") return "KPIs only";
  if (mode === "dashboard") return "Dashboard";
  return "Automatic layout";
}

function createCatalogFilters(options: {
  normalized: string;
  entity: SemanticEntity;
  intent: WorkspaceIntent;
  days: number;
  minimumAmount: number;
}): GatewayQueryPlan["filters"] {
  const filters: GatewayQueryPlan["filters"] = [];
  const now = new Date();
  if (options.intent === "renewals" && options.entity.dateField) {
    filters.push({
      field: options.entity.dateField,
      operator: "between",
      value: `${toDateOnly(now)}..${toDateOnly(addDays(now, options.days))}`,
    });
  } else if (
    options.normalized.includes("this month") &&
    options.entity.dateField &&
    fieldAllows(options.entity, options.entity.dateField, "current_month")
  ) {
    filters.push({
      field: options.entity.dateField,
      operator: "current_month",
      value: "current_month",
    });
  }
  const olderThanDays = extractNumber(
    options.normalized,
    /(?:more than|over|older than)\s+(\d+)\s+days?/,
    0,
  );
  if (
    olderThanDays > 0 &&
    options.entity.dateField &&
    fieldAllows(options.entity, options.entity.dateField, "before")
  ) {
    filters.push({
      field: options.entity.dateField,
      operator: "before",
      value: toDateOnly(addDays(now, -clamp(olderThanDays, 1, 3650))),
    });
  }
  if (options.minimumAmount > 0 && options.entity.amountField) {
    filters.push({
      field: options.entity.amountField,
      operator: "greater_than",
      value: options.minimumAmount,
    });
  }
  if (/\b(active|in force)\b/.test(options.normalized) && options.entity.statusField) {
    filters.push({ field: options.entity.statusField, operator: "equals", value: "active" });
  } else if (/\bpending|open|awaiting\b/.test(options.normalized) && options.entity.statusField) {
    filters.push({
      field: options.entity.statusField,
      operator: "in",
      value:
        options.entity.entity === "claims"
          ? "intimated,documents_pending,under_assessment,approved"
          : "requested,documents_pending,under_review",
    });
  }
  return filters.filter((filter) => fieldAllows(options.entity, filter.field, filter.operator));
}

function createCatalogSorting(
  normalized: string,
  entity: SemanticEntity,
): GatewayQueryPlan["orderBy"] {
  const candidates = entity.fields.filter((field) => field.sortable);
  if (/\b(high|highest|largest|top)\b/.test(normalized) && entity.amountField) {
    return [{ field: entity.amountField, direction: "desc" }];
  }
  if (/\b(oldest|longest|overdue)\b/.test(normalized) && entity.dateField) {
    return [{ field: entity.dateField, direction: "asc" }];
  }
  const mentioned = candidates.find((field) =>
    [field.name, field.label, ...field.synonyms].some((term) =>
      normalized.includes(term.toLowerCase()),
    ),
  );
  return mentioned ? [{ field: mentioned.name, direction: "asc" }] : [];
}

function fieldAllows(
  entity: SemanticEntity,
  fieldName: string,
  operator: GatewayQueryPlan["filters"][number]["operator"],
) {
  return Boolean(
    entity.fields
      .find((field) => field.name === fieldName)
      ?.filterOperators.includes(operator),
  );
}

function groupRecordValues(
  records: Array<Record<string, string | number | null>>,
  groupField: string,
  amountField?: string,
) {
  const groups = new Map<string, number>();
  for (const record of records) {
    const label = String(record[groupField] ?? "Unknown");
    const amount = amountField && typeof record[amountField] === "number"
      ? Number(record[amountField])
      : 1;
    groups.set(label, (groups.get(label) ?? 0) + amount);
  }
  return Array.from(groups, ([label, value]) => ({ label: humanize(label), value }))
    .sort((first, second) => second.value - first.value);
}

function groupRecordStats(
  records: Array<Record<string, string | number | null>>,
  groupField: string,
  amountField?: string,
): Array<Record<string, string | number | null>> {
  const groups = new Map<string, { count: number; total: number }>();
  for (const record of records) {
    const label = String(record[groupField] ?? "Unknown");
    const current = groups.get(label) ?? { count: 0, total: 0 };
    const amount = amountField && typeof record[amountField] === "number"
      ? Number(record[amountField])
      : 0;
    groups.set(label, {
      count: current.count + 1,
      total: current.total + amount,
    });
  }
  return Array.from(groups, ([group, values]) => ({
    group: humanize(group),
    record_count: values.count,
    ...(amountField
      ? {
          total_value: values.total,
          average_value: values.count ? values.total / values.count : 0,
        }
      : {}),
  })).sort(
    (first, second) =>
      Number(second.total_value ?? second.record_count) -
      Number(first.total_value ?? first.record_count),
  );
}

function formatMetric(value: number, format: SemanticMetric["format"]) {
  if (format === "currency") return formatCompactCurrency(value);
  if (format === "percentage") return `${Math.round(value)}%`;
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(value);
}

function formatFilterValue(value: string | number, format?: string) {
  if (format === "currency" && typeof value === "number") return formatCurrency(value);
  return humanize(String(value).replace("..", " to ").replaceAll(",", ", "));
}

function toTableFormat(format: SemanticEntity["fields"][number]["format"]): TableCellFormat {
  if (["badge", "currency", "date", "id", "person"].includes(format)) {
    return format as TableCellFormat;
  }
  return "text";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function shortProductName(value: string) {
  return value.replace("Comprehensive", "Comp.").replace("Standalone Own Damage", "SAOD");
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value);
}

function formatCompactCurrency(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function formatDate(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short" }).format(new Date(`${value}T00:00:00Z`));
}

function addDays(value: Date, days: number) {
  const result = new Date(value);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}
