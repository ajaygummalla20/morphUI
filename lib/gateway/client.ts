import { validateAnalysis } from "./analysis";
import type { WorkspacePlan, WorkspaceSourceMode } from "@/lib/workspaces/dynamic";
import type { SemanticEntity } from "@/lib/catalog/semantic";
import {
  GATEWAY_PROTOCOL_VERSION,
  gatewayAggregateRowSchema,
  gatewayCatalogRequestSchema,
  gatewayCatalogResultSchema,
  gatewayHealthResponseSchema,
  gatewayExecuteRequestSchema,
  gatewayExecuteResponseSchema,
  type GatewayAllowResponse,
  type GatewayCatalogRequest,
  type GatewayCatalogResponse,
  type GatewayExecuteRequest,
  type GatewayIdentity,
  type GatewayQueryPlan,
} from "./contract";
import {
  executeSecureDemoCatalog,
  executeSecureDemoGateway,
} from "./secure-demo";

export class GatewayDeniedError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
    readonly decisionId: string,
    readonly policyVersion: string,
  ) {
    super(message);
  }
}

export class GatewayProtocolError extends Error {}
export class GatewayIdentityRequiredError extends Error {}

export type WorkspaceGatewayExecution = {
  decision: GatewayAllowResponse;
  sourceMode: WorkspaceSourceMode;
  records: Array<Record<string, string | number | null>>;
};

export type GatewayCatalogExecution = {
  catalog: GatewayCatalogResponse;
  sourceMode: WorkspaceSourceMode;
};

export async function discoverGatewayCatalog(options: {
  identity: GatewayIdentity | ((requestId:string)=>Promise<GatewayIdentity>);
  connectorId?: string;
  purpose?:'runtime'|'onboarding';
}): Promise<GatewayCatalogExecution> {
  const requestId=crypto.randomUUID();
  const request = gatewayCatalogRequestSchema.parse({
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    requestId,
    connectorId:
      options.connectorId ?? "connector_production_postgresql",
    identity: typeof options.identity === 'function' ? await options.identity(requestId) : options.identity,
    purpose:options.purpose??'onboarding',
  } satisfies GatewayCatalogRequest);
  const gatewayUrl = process.env.MORPH_GATEWAY_URL?.trim();
  const result = gatewayUrl
    ? await executeRemoteCatalog(gatewayUrl, request)
    : executeSecureDemoCatalog(request);

  assertDecisionMatchesRequest(result, request, Boolean(gatewayUrl));

  if (result.decision === "deny") {
    throw new GatewayDeniedError(
      result.reasonCode,
      result.reason,
      result.decisionId,
      result.policyVersion,
    );
  }
  return {
    catalog: result,
    sourceMode: gatewayUrl ? "client_gateway" : "secure_demo",
  };
}

export async function executeWorkspaceGateway(options: {
  plan: WorkspacePlan;
  queryPlan: GatewayQueryPlan;
  catalogEntity: SemanticEntity;
  identity: GatewayIdentity | ((requestId:string)=>Promise<GatewayIdentity>);
  connectorId?: string;
}): Promise<WorkspaceGatewayExecution> {
  const requestId=crypto.randomUUID();
  const request = gatewayExecuteRequestSchema.parse({
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    requestId,
    connectorId:
      options.connectorId ?? "connector_production_postgresql",
    identity: typeof options.identity === 'function' ? await options.identity(requestId) : options.identity,
    plan: options.queryPlan,
  } satisfies GatewayExecuteRequest);

  const gatewayUrl = process.env.MORPH_GATEWAY_URL?.trim();
  const response = gatewayUrl
    ? await executeRemoteGateway(gatewayUrl, request)
    : executeSecureDemoGateway(request, options.plan);

  assertDecisionMatchesRequest(response, request, Boolean(gatewayUrl));

  if (response.decision === "deny") {
    throw new GatewayDeniedError(
      response.reasonCode,
      response.reason,
      response.decisionId,
      response.policyVersion,
    );
  }

  const selectedFields = new Set(request.plan.fields);
  const analytical = Boolean(request.plan.analysis);
  if (analytical) {
    try {
      validateAnalysis(request.plan, options.catalogEntity);
      response.rows.forEach(row => gatewayAggregateRowSchema.parse(row));
      if (response.resultScope !== "all_matching_records" || response.maskedFields.length) throw new Error("Invalid analysis scope");
    } catch { throw new GatewayProtocolError("The Gateway did not return a complete, approved analysis."); }
  }
  if (
    response.catalogVersion !== request.plan.catalogVersion ||
    JSON.stringify(response.executedPlan) !== JSON.stringify(request.plan) ||
    response.rows.length > request.plan.rowLimit ||
    response.returnedRows !== response.rows.length ||
    response.rows.length > response.maximumRows ||
    (!analytical && response.rows.some((row) => Object.keys(row).length !== selectedFields.size ||
      Object.keys(row).some((field) => !selectedFields.has(field)))) ||
    response.maskedFields.some((field) => !selectedFields.has(field)) ||
    (!analytical && options.catalogEntity.fields.some((field) => field.masked && selectedFields.has(field.name) && !response.maskedFields.includes(field.name)))
  ) {
    throw new GatewayProtocolError("The client Gateway response does not match the approved query plan.");
  }

  return {
    decision: response,
    sourceMode: gatewayUrl ? "client_gateway" : "secure_demo",
    records: analytical ? response.rows.map(row => gatewayAggregateRowSchema.parse(row)) : decodeGatewayRows(options.catalogEntity, response.rows),
  };
}

async function executeRemoteGateway(
  gatewayUrl: string,
  request: GatewayExecuteRequest,
) {
  const endpoint = new URL("/v1/query-plans/execute", gatewayUrl);
  assertSecureGatewayUrl(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const token = process.env.MORPH_GATEWAY_SERVICE_TOKEN?.trim();
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const payload: unknown = await response.json();
    const parsed = gatewayExecuteResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new GatewayProtocolError(
        `The client Gateway returned a response outside protocol v${GATEWAY_PROTOCOL_VERSION}.`,
      );
    }
    if (!response.ok && parsed.data.decision !== "deny") {
      throw new GatewayProtocolError(
        "The client Gateway failed without a deterministic denial.",
      );
    }
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

async function executeRemoteCatalog(
  gatewayUrl: string,
  request: GatewayCatalogRequest,
) {
  const endpoint = new URL("/v1/catalog/discover", gatewayUrl);
  assertSecureGatewayUrl(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const token = process.env.MORPH_GATEWAY_SERVICE_TOKEN?.trim();
    const response = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const payload: unknown = await response.json();
    const parsed = gatewayCatalogResultSchema.safeParse(payload);
    if (!parsed.success) {
      throw new GatewayProtocolError(
        `The client Gateway returned a catalog outside protocol v${GATEWAY_PROTOCOL_VERSION}.`,
      );
    }
    if (!response.ok && parsed.data.decision !== "deny") {
      throw new GatewayProtocolError(
        "The client Gateway catalog failed without a deterministic denial.",
      );
    }
    return parsed.data;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeGatewayRows(
  entity: SemanticEntity,
  rows: Array<Record<string, unknown>>,
): WorkspaceGatewayExecution["records"] {
  try {
    const allowedFields = new Map(entity.fields.map((field) => [field.name, field]));
    return rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => {
          const field = allowedFields.get(key);
          if (!field) throw new Error(`Unknown Gateway field: ${key}`);
          if (value === null) return [key, null];
          if (field.dataType === "number" && typeof value !== "number") {
            throw new Error(`Gateway field ${key} must be numeric.`);
          }
          if (field.dataType !== "number" && typeof value !== "string") {
            throw new Error(`Gateway field ${key} must be text.`);
          }
          return [key, value as string | number];
        }),
      ),
    );
  } catch {
    throw new GatewayProtocolError(
      "The client Gateway returned rows outside the approved catalogue schema.",
    );
  }
}

export function gatewayIdentityFromRequest(request: Request): GatewayIdentity {
  const organizationId =
    process.env.MORPH_ORGANIZATION_ID?.trim() || "org_atlas_insurance";
  const remoteGatewayEnabled = Boolean(process.env.MORPH_GATEWAY_URL?.trim());
  const assertion = request.headers
    .get("x-morph-client-identity-assertion")
    ?.trim();

  if (remoteGatewayEnabled && !assertion) {
    throw new GatewayIdentityRequiredError(
      "A verified client identity assertion is required for this Gateway.",
    );
  }

  return {
    organizationId,
    assertion:
      assertion ??
      "secure-demo-identity-assertion-not-valid-at-a-client-gateway",
  };
}

export async function getGatewayHealth() {
  const gatewayUrl = process.env.MORPH_GATEWAY_URL?.trim();
  if (!gatewayUrl) {
    return {
      mode: "secure_demo" as const,
      status: "healthy" as const,
      protocolVersion: GATEWAY_PROTOCOL_VERSION,
      gatewayId: "morph-secure-demo-gateway",
      policyVersion: "atlas-demo-policy-2026-08-12",
      catalogVersion: "insurance-catalog-2026-09-01",
      checkedAt: new Date().toISOString(),
    };
  }

  const endpoint = new URL("/v1/health", gatewayUrl);
  assertSecureGatewayUrl(endpoint);
  const token = process.env.MORPH_GATEWAY_SERVICE_TOKEN?.trim();
  const response = await fetch(endpoint, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const result = gatewayHealthResponseSchema.safeParse(await response.json());
  if (!response.ok || !result.success) {
    throw new GatewayProtocolError("The client Gateway health check failed.");
  }
  return { mode: "client_gateway" as const, ...result.data };
}

function assertSecureGatewayUrl(endpoint: URL) {
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    ["localhost", "127.0.0.1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !localDevelopment) {
    throw new GatewayProtocolError(
      "Production Gateway connections require HTTPS.",
    );
  }
}

function assertDecisionMatchesRequest(
  response: { requestId: string; connectorId: string; decision: string; identityVerified?: boolean; identityProvider?: string; identityExpiresAt?: string },
  request: { requestId: string; connectorId: string },
  remote: boolean,
) {
  if (response.requestId !== request.requestId || response.connectorId !== request.connectorId ||
    (response.decision === "allow" && (response.identityVerified !== true ||
      (remote && response.identityProvider !== "oidc") ||
      !response.identityExpiresAt || Date.parse(response.identityExpiresAt) <= Date.now()))) {
    throw new GatewayProtocolError("The client Gateway response is not bound to this verified request.");
  }
}
