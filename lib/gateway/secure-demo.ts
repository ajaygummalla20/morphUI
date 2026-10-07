import { validateAnalysis } from "./analysis";
import {
  createDemoRows,
  type ClaimWorkspaceRow,
  type EndorsementWorkspaceRow,
  type PolicyWorkspaceRow,
  type WorkspacePlan,
} from "@/lib/workspaces/dynamic";
import type { RenewalRecord } from "@/lib/workspaces/renewals";
import { insuranceSemanticCatalog } from "@/lib/catalog/semantic";
import { queryDemoRows } from "./demo-query";
import {
  GATEWAY_PROTOCOL_VERSION,
  gatewayCatalogRequestSchema,
  gatewayExecuteRequestSchema,
  type GatewayCatalogRequest,
  type GatewayCatalogResponse,
  type GatewayAllowResponse,
  type GatewayDenyResponse,
  type GatewayExecuteRequest,
  type GatewayQueryPlan,
} from "./contract";

const demoPolicy = {
  version: "atlas-demo-policy-2026-08-12",
  catalogVersion: insuranceSemanticCatalog.catalogVersion,
  groups: {
    "Workspace admins": ["policies", "claims", "endorsements"],
    "Operations team": ["policies", "endorsements"],
    "Claims managers": ["claims"],
    "Support leads": ["endorsements"],
  },
  fields: {
    policies: [
      "policy_number",
      "customer_name",
      "product",
      "branch",
      "relationship_manager",
      "start_date",
      "expiry_date",
      "total_premium",
      "status",
      "renewal_status",
      "propensity_score",
    ],
    claims: [
      "claim_number",
      "policy_number",
      "customer_name",
      "branch",
      "intimation_date",
      "claimed_amount",
      "approved_amount",
      "status",
      "cause",
    ],
    endorsements: [
      "endorsement_number",
      "policy_number",
      "customer_name",
      "type",
      "status",
      "requested_at",
      "effective_date",
      "premium_delta",
      "branch",
    ],
  },
  maskedFields: ["customer_name"],
  sources: {
    policies: "policies_read_replica",
    claims: "claims_read_replica",
    endorsements: "endorsements_read_replica",
  },
} as const;

export function executeSecureDemoCatalog(
  input: GatewayCatalogRequest,
): GatewayCatalogResponse {
  const request = gatewayCatalogRequestSchema.parse(input);
  return {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    requestId: request.requestId,
    decisionId: `decision_${crypto.randomUUID()}`,
    connectorId: request.connectorId,
    policyVersion: demoPolicy.version,
    decidedAt: new Date().toISOString(),
    decision: "allow",
    identityVerified: true,
    identityProvider: "secure_demo",
    identityIssuer: "morph-secure-demo",
    identityExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    databaseEngine: "PostgreSQL",
    connectionStatus: "ready",
    catalogVersion: demoPolicy.catalogVersion,
    entities: insuranceSemanticCatalog.entities.map((entity) => ({
      ...entity,
      source: demoPolicy.sources[entity.entity],
      fields: entity.fields.map((field) => ({
        ...field,
        masked: demoPolicy.maskedFields.includes(field.name as "customer_name"),
      })),
    })),
    relationships: insuranceSemanticCatalog.relationships,
  };
}

export function executeSecureDemoGateway(
  input: GatewayExecuteRequest,
  workspacePlan: WorkspacePlan,
  demoGroups: string[] = ["Workspace admins"],
): GatewayAllowResponse | GatewayDenyResponse {
  const request = gatewayExecuteRequestSchema.parse(input);
  const decisionBase = {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    requestId: request.requestId,
    decisionId: `decision_${crypto.randomUUID()}`,
    connectorId: request.connectorId,
    policyVersion: demoPolicy.version,
    decidedAt: new Date().toISOString(),
  } as const;
  const allowedEntities = new Set(
    demoGroups.flatMap(
      (group) =>
        demoPolicy.groups[group as keyof typeof demoPolicy.groups] ?? [],
    ),
  );

  if (!allowedEntities.has(request.plan.entity)) {
    return {
      ...decisionBase,
      decision: "deny",
      reasonCode: "entity_not_allowed",
      reason: `The client policy does not grant this identity access to ${request.plan.entity}.`,
    };
  }

  if (request.plan.source !== demoPolicy.sources[request.plan.entity]) {
    return {
      ...decisionBase,
      decision: "deny",
      reasonCode: "entity_not_allowed",
      reason: "The requested source is not approved for this entity.",
    };
  }

  if (request.plan.catalogVersion !== demoPolicy.catalogVersion) {
    return {
      ...decisionBase,
      decision: "deny",
      reasonCode: "catalog_version_mismatch",
      reason: "The query plan was created from an outdated semantic catalog.",
    };
  }

  const permittedFields = new Set(demoPolicy.fields[request.plan.entity]);
  const prohibitedField = request.plan.fields.find(
    (field) => !permittedFields.has(field as never),
  );
  if (prohibitedField) {
    return {
      ...decisionBase,
      decision: "deny",
      reasonCode: "field_not_allowed",
      reason: `Field ${prohibitedField} is not allowed by the client policy.`,
    };
  }

  const prohibitedSort = request.plan.orderBy.find(
    (sort) => !permittedFields.has(sort.field as never),
  );
  if (prohibitedSort) {
    return {
      ...decisionBase,
      decision: "deny",
      reasonCode: "sort_not_allowed",
      reason: `Sorting by ${prohibitedSort.field} is not allowed by the client policy.`,
    };
  }
  const semanticEntity = insuranceSemanticCatalog.entities.find(
    (entity) => entity.entity === request.plan.entity,
  );
  const prohibitedFilter = request.plan.filters.find((filter) => {
    const field = semanticEntity?.fields.find((candidate) => candidate.name === filter.field);
    return !field || !permittedFields.has(filter.field as never) || !field.filterOperators.includes(filter.operator);
  });
  if (prohibitedFilter) {
    return {
      ...decisionBase,
      decision: "deny",
      reasonCode: "filter_not_allowed",
      reason: `Filter ${prohibitedFilter.field}:${prohibitedFilter.operator} is not allowed by the client policy.`,
    };
  }
  const groupField = request.plan.groupBy
    ? semanticEntity?.fields.find((field) => field.name === request.plan.groupBy)
    : undefined;
  if (request.plan.groupBy && (!groupField?.groupable || !permittedFields.has(request.plan.groupBy as never))) {
    return {
      ...decisionBase,
      decision: "deny",
      reasonCode: "filter_not_allowed",
      reason: `Grouping by ${request.plan.groupBy} is not allowed by the client policy.`,
    };
  }

  if (request.plan.analysis) {
    try { validateAnalysis(request.plan, semanticEntity!); }
    catch { return { ...decisionBase, decision: "deny", reasonCode: "filter_not_allowed", reason: "The requested analysis is not approved." }; }
  }
  const rows = queryDemoRows(encodeRows(workspacePlan), request.plan).map((row) =>
    request.plan.analysis ? row : maskApprovedFields(row, demoPolicy.maskedFields),
  );

  if (request.plan.analysis && rows.length > request.plan.rowLimit) {
    return { ...decisionBase, decision: "deny", reasonCode: "row_limit_exceeded", reason: "Choose fewer categories or a coarser date interval to return the complete analysis." };
  }
  return {
    ...decisionBase,
    decision: "allow",
    resultScope: request.plan.analysis ? "all_matching_records" : "returned_records",
    catalogVersion: demoPolicy.catalogVersion,
    identityVerified: true,
    identityProvider: "secure_demo",
    identityIssuer: "morph-secure-demo",
    identityExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    executedPlan: request.plan,
    rows: rows.slice(0, request.plan.rowLimit),
    maskedFields: request.plan.analysis ? [] : [...demoPolicy.maskedFields].filter((field) =>
      request.plan.fields.includes(field),
    ),
    returnedRows: Math.min(rows.length, request.plan.rowLimit),
    maximumRows: request.plan.rowLimit,
  };
}

function encodeRows(plan: WorkspacePlan): Array<Record<string, unknown>> {
  // Generate a stable sample, then execute the actual query plan over it.
  const rows = createDemoRows(plan.intent, { ...plan, days: 90, minimumAmount: 0, limit: 200 });

  if (plan.intent === "renewals") {
    return (rows as RenewalRecord[]).map((row, index) => ({
      policy_number: row.policyNumber,
      customer_name: row.customerName,
      product: ["Private Car Comprehensive", "Two Wheeler Comprehensive", "Commercial Vehicle Comprehensive"][index % 3],
      status: "active",
      start_date: new Date(Date.parse(row.expiryDate) - 365 * 86_400_000).toISOString().slice(0, 10),
      expiry_date: row.expiryDate,
      total_premium: row.premium,
      relationship_manager: row.relationshipManager,
      branch: row.branch,
      renewal_status: row.renewalStatus,
      propensity_score: row.propensityScore,
    }));
  }
  if (plan.intent === "claims") {
    return (rows as ClaimWorkspaceRow[]).map((row) => ({
      claim_number: row.claimNumber,
      policy_number: row.policyNumber,
      customer_name: row.customerName,
      branch: row.branch,
      intimation_date: row.intimationDate,
      claimed_amount: row.claimedAmount,
      approved_amount: row.approvedAmount,
      status: row.status,
      cause: row.cause,
    }));
  }
  if (plan.intent === "endorsements") {
    return (rows as EndorsementWorkspaceRow[]).map((row) => ({
      endorsement_number: row.endorsementNumber,
      policy_number: row.policyNumber,
      customer_name: row.customerName,
      type: row.type,
      status: row.status,
      requested_at: row.requestedAt,
      effective_date: row.effectiveDate,
      premium_delta: row.premiumDelta,
      branch: row.branch,
    }));
  }
  return (rows as PolicyWorkspaceRow[]).map((row) => ({
    policy_number: row.policyNumber,
    customer_name: row.customerName,
    product: row.product,
    branch: row.branch,
    relationship_manager: row.relationshipManager,
    start_date: row.startDate,
    expiry_date: row.expiryDate,
    total_premium: row.premium,
    status: row.status,
    renewal_status: null,
    propensity_score: null,
  }));
}

function maskApprovedFields(
  row: Record<string, unknown>,
  maskedFields: readonly string[],
) {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => [
      field,
      maskedFields.includes(field) && typeof value === "string"
        ? maskDisplayValue(value)
        : value,
    ]),
  );
}

function maskDisplayValue(value: string) {
  const prefix = value.trim().slice(0, 1).toUpperCase() || "C";
  return `${prefix}•••••• customer`;
}

export function getDemoPolicyForTests() {
  return demoPolicy;
}

export function createDemoGatewayRequestForTests(options: {
  plan: GatewayQueryPlan;
}): GatewayExecuteRequest {
  return {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    requestId: crypto.randomUUID(),
    connectorId: "connector_production_postgresql",
    identity: {
      organizationId: "org_atlas_insurance",
      assertion:
        "secure-demo-identity-assertion-not-valid-at-a-client-gateway",
    },
    plan: options.plan,
  };
}
