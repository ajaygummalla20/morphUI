import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { ZodError } from "zod";
import { insuranceSemanticCatalog } from "../../lib/catalog/semantic.js";
import {
  GATEWAY_PROTOCOL_VERSION,
  gatewayAllowResponseSchema,
  gatewayCatalogRequestSchema,
  gatewayCatalogResponseSchema,
  gatewayDenyResponseSchema,
  gatewayExecuteRequestSchema,
  gatewayHealthResponseSchema,
  type GatewayExecuteRequest,
  type GatewayCatalogRequest,
} from "../../lib/gateway/contract.js";
import { writeAuditEvent } from "./audit.js";
import { compileCatalogProbe, compileQuery } from "./compiler.js";
import { loadGatewayConfig, type GatewayConfig } from "./config.js";
import { createQueryExecutor, type QueryExecutor } from "./database.js";
import {
  createOidcIdentityVerifier,
  IdentityVerificationError,
  type IdentityVerifier,
} from "./identity.js";
import {
  applyMasking,
  evaluateOnboardingPolicy,
  evaluatePolicy,
  type GatewayPolicy,
  type PolicyReasonCode,
} from "./policy.js";

const MAX_REQUEST_BYTES = 128 * 1024;

export function createGatewayServer(options: {
  config: GatewayConfig;
  policy: GatewayPolicy;
  execute: QueryExecutor;
  verifyIdentity: IdentityVerifier;
}) {
  return createServer(async (request, response) => {
    setSecurityHeaders(response);

    try {
      if (!authenticate(request, options.config.serviceToken)) {
        sendJson(response, 401, { error: "Unauthorized Gateway request." });
        return;
      }
      const url = new URL(request.url ?? "/", "http://gateway.internal");

      if (request.method === "GET" && url.pathname === "/v1/health") {
        sendJson(
          response,
          200,
          gatewayHealthResponseSchema.parse({
            status: "healthy",
            protocolVersion: GATEWAY_PROTOCOL_VERSION,
            gatewayId: options.config.gatewayId,
            policyVersion: options.policy.version,
            catalogVersion: options.policy.catalogVersion,
            checkedAt: new Date().toISOString(),
          }),
        );
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/query-plans/execute"
      ) {
        const input = gatewayExecuteRequestSchema.parse(
          await readJsonBody(request),
        );
        await handleExecution(input, response, options);
        return;
      }

      if (
        request.method === "POST" &&
        url.pathname === "/v1/catalog/discover"
      ) {
        const input = gatewayCatalogRequestSchema.parse(
          await readJsonBody(request),
        );
        await handleCatalogDiscovery(input, response, options);
        return;
      }

      sendJson(response, 404, { error: "Gateway endpoint not found." });
    } catch (error) {
      if (error instanceof RequestTooLargeError) {
        sendJson(response, 413, { error: "Gateway request is too large." });
      } else if (error instanceof SyntaxError || error instanceof ZodError) {
        sendJson(response, 400, {
          error: `Gateway request does not match protocol v${GATEWAY_PROTOCOL_VERSION}.`,
        });
      } else {
        console.error(
          JSON.stringify({
            type: "morph_gateway_error",
            occurredAt: new Date().toISOString(),
            message: error instanceof Error ? error.message : "Unknown error",
          }),
        );
        sendJson(response, 500, {
          error: "Gateway execution failed. No partial data was returned.",
        });
      }
    }
  });
}

async function handleCatalogDiscovery(
  request: GatewayCatalogRequest,
  response: ServerResponse,
  options: {
    config: GatewayConfig;
    policy: GatewayPolicy;
    execute: QueryExecutor;
    verifyIdentity: IdentityVerifier;
  },
) {
  const startedAt = performance.now();
  const decisionId = `decision_${randomUUID()}`;
  const decisionBase = {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    requestId: request.requestId,
    decisionId,
    connectorId: request.connectorId,
    policyVersion: options.policy.version,
    decidedAt: new Date().toISOString(),
  } as const;

  let identity;
  try {
    identity = await options.verifyIdentity(request.identity.assertion, {
      organizationId: request.identity.organizationId,
      requestId: request.requestId,
    });
  } catch (error) {
    if (!(error instanceof IdentityVerificationError)) throw error;
    sendCatalogDenial({
      response,
      request,
      options,
      decisionBase,
      decisionId,
      startedAt,
      reasonCode: error.reasonCode,
      reason: error.message,
      subjectId: `unverified:${request.requestId}`,
    });
    return;
  }

  const policyDecision = evaluateOnboardingPolicy(
    request,
    options.policy,
    identity,
  );
  if (!policyDecision.allowed) {
    sendCatalogDenial({
      response,
      request,
      options,
      decisionBase,
      decisionId,
      startedAt,
      reasonCode: policyDecision.reasonCode,
      reason: policyDecision.reason,
      subjectId: identity.subjectId,
      organizationId: identity.organizationId,
    });
    return;
  }

  const entityNames = insuranceSemanticCatalog.entities.map(
    (entity) => entity.entity,
  );
  await Promise.all(
    entityNames.map((entity) => {
      const entityPolicy = options.policy.entities[entity];
      return options.execute(
        compileCatalogProbe({
          entity,
          source: entityPolicy.source,
          fields: entityPolicy.fields,
        }),
      );
    }),
  );

  const entities = entityNames.map((entity) => {
    const entityPolicy = options.policy.entities[entity];
    const semantic = insuranceSemanticCatalog.entities.find(
      (candidate) => candidate.entity === entity,
    );
    if (!semantic) throw new Error(`Semantic catalog is missing ${entity}.`);
    const allowedFields = new Set(entityPolicy.fields);
    return {
      ...semantic,
      source: entityPolicy.source,
      defaultFields: semantic.defaultFields.filter((field) => allowedFields.has(field)),
      dateField:
        semantic.dateField && allowedFields.has(semantic.dateField)
          ? semantic.dateField
          : null,
      amountField:
        semantic.amountField && allowedFields.has(semantic.amountField)
          ? semantic.amountField
          : null,
      statusField:
        semantic.statusField && allowedFields.has(semantic.statusField)
          ? semantic.statusField
          : null,
      fields: semantic.fields
        .filter((field) => allowedFields.has(field.name))
        .map((field) => ({
          ...field,
          filterOperators: (entityPolicy.filterOperators[field.name] ?? []).filter(
            (operator) => field.filterOperators.includes(operator),
          ),
          groupable: field.groupable && entityPolicy.groupBy.includes(field.name),
          sortable: field.sortable && entityPolicy.sortBy.includes(field.name),
          masked: Boolean(options.policy.masking[field.name]),
        })),
      metrics: semantic.metrics.filter(
        (metric) => !metric.field || allowedFields.has(metric.field),
      ),
      maximumRows: entityPolicy.maximumRows,
    };
  });
  const availableEntityNames = new Set(entities.map((entity) => entity.entity));
  const relationships = insuranceSemanticCatalog.relationships.filter(
    (relationship) =>
      availableEntityNames.has(relationship.fromEntity) &&
      availableEntityNames.has(relationship.toEntity) &&
      entities
        .find((entity) => entity.entity === relationship.fromEntity)
        ?.fields.some((field) => field.name === relationship.fromField) &&
      entities
        .find((entity) => entity.entity === relationship.toEntity)
        ?.fields.some((field) => field.name === relationship.toField),
  );
  const allowed = gatewayCatalogResponseSchema.parse({
    ...decisionBase,
    decision: "allow",
    identityVerified: true,
    identityProvider: identity.identityProvider,
    identityIssuer: identity.issuer,
    identityExpiresAt: identity.expiresAt,
    databaseEngine: "PostgreSQL",
    connectionStatus: "ready",
    catalogVersion: options.policy.catalogVersion,
    entities,
    relationships,
  });
  writeAuditEvent(
    {
      requestId: request.requestId,
      decisionId,
      decision: "allow",
      organizationId: identity.organizationId,
      connectorId: request.connectorId,
      subjectId: identity.subjectId,
      entity: "catalog",
      fieldCount: entities.reduce(
        (total, entity) => total + entity.fields.length,
        0,
      ),
      rowLimit: 0,
      returnedRows: 0,
      policyVersion: options.policy.version,
      durationMs: Math.round(performance.now() - startedAt),
    },
    options.config.auditHashSalt,
  );
  sendJson(response, 200, allowed);
}

function sendCatalogDenial(options: {
  response: ServerResponse;
  request: GatewayCatalogRequest;
  options: { config: GatewayConfig; policy: GatewayPolicy };
  decisionBase: {
    protocolVersion: typeof GATEWAY_PROTOCOL_VERSION;
    requestId: string;
    decisionId: string;
    connectorId: string;
    policyVersion: string;
    decidedAt: string;
  };
  decisionId: string;
  startedAt: number;
  reasonCode: IdentityVerificationError["reasonCode"] | PolicyReasonCode;
  reason: string;
  subjectId: string;
  organizationId?: string;
}) {
  const denied = gatewayDenyResponseSchema.parse({
    ...options.decisionBase,
    decision: "deny",
    reasonCode: options.reasonCode,
    reason: options.reason,
  });
  writeAuditEvent(
    {
      requestId: options.request.requestId,
      decisionId: options.decisionId,
      decision: "deny",
      reasonCode: options.reasonCode,
      organizationId:
        options.organizationId ?? options.request.identity.organizationId,
      connectorId: options.request.connectorId,
      subjectId: options.subjectId,
      entity: "catalog",
      fieldCount: 0,
      rowLimit: 0,
      policyVersion: options.options.policy.version,
      durationMs: Math.round(performance.now() - options.startedAt),
    },
    options.options.config.auditHashSalt,
  );
  sendJson(options.response, 403, denied);
}

async function handleExecution(
  request: GatewayExecuteRequest,
  response: ServerResponse,
  options: {
    config: GatewayConfig;
    policy: GatewayPolicy;
    execute: QueryExecutor;
    verifyIdentity: IdentityVerifier;
  },
) {
  const startedAt = performance.now();
  const decisionId = `decision_${randomUUID()}`;
  const decisionBase = {
    protocolVersion: GATEWAY_PROTOCOL_VERSION,
    requestId: request.requestId,
    decisionId,
    connectorId: request.connectorId,
    policyVersion: options.policy.version,
    decidedAt: new Date().toISOString(),
  } as const;

  let identity;
  try {
    identity = await options.verifyIdentity(request.identity.assertion, {
      organizationId: request.identity.organizationId,
      requestId: request.requestId,
    });
  } catch (error) {
    if (!(error instanceof IdentityVerificationError)) throw error;
    const denied = gatewayDenyResponseSchema.parse({
      ...decisionBase,
      decision: "deny",
      reasonCode: error.reasonCode,
      reason: error.message,
    });
    writeAuditEvent(
      {
        requestId: request.requestId,
        decisionId,
        decision: "deny",
        reasonCode: error.reasonCode,
        organizationId: request.identity.organizationId,
        connectorId: request.connectorId,
        subjectId: `unverified:${request.requestId}`,
        entity: request.plan.entity,
        fieldCount: request.plan.fields.length,
        rowLimit: request.plan.rowLimit,
        policyVersion: options.policy.version,
        durationMs: Math.round(performance.now() - startedAt),
      },
      options.config.auditHashSalt,
    );
    sendJson(response, 403, denied);
    return;
  }

  const decision = evaluatePolicy(request, options.policy, identity);

  if (!decision.allowed) {
    const denied = gatewayDenyResponseSchema.parse({
      ...decisionBase,
      decision: "deny",
      reasonCode: decision.reasonCode,
      reason: decision.reason,
    });
    writeAuditEvent(
      {
        requestId: request.requestId,
        decisionId,
        decision: "deny",
        reasonCode: decision.reasonCode,
        organizationId: identity.organizationId,
        connectorId: request.connectorId,
        subjectId: identity.subjectId,
        entity: request.plan.entity,
        fieldCount: request.plan.fields.length,
        rowLimit: request.plan.rowLimit,
        policyVersion: options.policy.version,
        durationMs: Math.round(performance.now() - startedAt),
      },
      options.config.auditHashSalt,
    );
    sendJson(response, 403, denied);
    return;
  }

  try {
    const query = compileQuery(request.plan);
    const databaseRows = await options.execute(query);
    const masked = applyMasking(databaseRows, request.plan, options.policy);
    const allowed = gatewayAllowResponseSchema.parse({
      ...decisionBase,
      decision: "allow",
      catalogVersion: options.policy.catalogVersion,
      identityVerified: true,
      identityProvider: identity.identityProvider,
      identityIssuer: identity.issuer,
      identityExpiresAt: identity.expiresAt,
      executedPlan: request.plan,
      rows: masked.rows,
      maskedFields: masked.maskedFields,
      returnedRows: masked.rows.length,
      maximumRows: decision.entityPolicy.maximumRows,
    });
    writeAuditEvent(
      {
        requestId: request.requestId,
        decisionId,
        decision: "allow",
        organizationId: identity.organizationId,
        connectorId: request.connectorId,
        subjectId: identity.subjectId,
        entity: request.plan.entity,
        fieldCount: request.plan.fields.length,
        rowLimit: request.plan.rowLimit,
        returnedRows: masked.rows.length,
        policyVersion: options.policy.version,
        durationMs: Math.round(performance.now() - startedAt),
      },
      options.config.auditHashSalt,
    );
    sendJson(response, 200, allowed);
  } catch (error) {
    writeAuditEvent(
      {
        requestId: request.requestId,
        decisionId,
        decision: "error",
        reasonCode: "execution_failed",
        organizationId: identity.organizationId,
        connectorId: request.connectorId,
        subjectId: identity.subjectId,
        entity: request.plan.entity,
        fieldCount: request.plan.fields.length,
        rowLimit: request.plan.rowLimit,
        policyVersion: options.policy.version,
        durationMs: Math.round(performance.now() - startedAt),
      },
      options.config.auditHashSalt,
    );
    throw error;
  }
}

function authenticate(request: IncomingMessage, expectedToken: string) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;
  const suppliedToken = authorization.slice("Bearer ".length).trim();
  if (!suppliedToken) return false;
  const suppliedHash = createHash("sha256").update(suppliedToken).digest();
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(suppliedHash, expectedHash);
}

async function readJsonBody(request: IncomingMessage) {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_REQUEST_BYTES) throw new RequestTooLargeError();
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'none'");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  if (response.headersSent) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

class RequestTooLargeError extends Error {}

async function startGateway() {
  const { config, policy } = await loadGatewayConfig();
  const database = createQueryExecutor(config.databaseUrl);
  const verifyIdentity = createOidcIdentityVerifier(config.identity);
  const server = createGatewayServer({
    config,
    policy,
    execute: database.execute,
    verifyIdentity,
  });
  server.listen(config.port, "0.0.0.0", () => {
    console.log(
      JSON.stringify({
        type: "morph_gateway_started",
        gatewayId: config.gatewayId,
        protocolVersion: GATEWAY_PROTOCOL_VERSION,
        policyVersion: policy.version,
        port: config.port,
      }),
    );
  });

  const shutdown = async () => {
    server.close();
    await database.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startGateway().catch((error) => {
    console.error(
      JSON.stringify({
        type: "morph_gateway_start_failed",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    );
    process.exitCode = 1;
  });
}
