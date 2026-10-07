import { z } from "zod";
import {
  semanticEntityNameSchema,
  semanticEntitySchema,
  semanticFilterOperatorSchema,
  semanticRelationshipSchema,
} from "../catalog/semantic.js";

export const GATEWAY_PROTOCOL_VERSION = "1.3" as const;
export const MAX_GATEWAY_ROWS = 200;

export const gatewayAnalysisSchema = z.object({
  metricId: z.string().regex(/^[a-z0-9_]+$/),
  time: z.object({
    field: z.string().regex(/^[a-z0-9_]+$/),
    grain: z.enum(["day", "week", "month", "year"]),
    start: z.iso.date(),
    end: z.iso.date(),
  }).strict().nullable(),
  comparison: z.enum(["none", "previous_bucket"]),
}).strict();

export const gatewayAggregateRowSchema = z.object({
  bucket: z.iso.date().nullable(),
  group: z.string().nullable(),
  value: z.number().finite().nullable(),
  record_count: z.number().int().nonnegative(),
}).strict();

const gatewayFilterSchema = z
  .object({
    field: z.string().regex(/^[a-z0-9_]+$/),
    operator: semanticFilterOperatorSchema,
    value: z.union([z.string(), z.number()]),
  })
  .strict();

export const gatewayQueryPlanSchema = z
  .object({
    source: z.string().regex(/^[a-z0-9_]+$/),
    catalogVersion: z.string().min(1).max(100),
    operation: z.literal("select"),
    entity: semanticEntityNameSchema,
    fields: z
      .array(z.string().regex(/^[a-z0-9_]+$/))
      .min(1)
      .max(30),
    filters: z.array(gatewayFilterSchema).max(12),
    analysis: gatewayAnalysisSchema.optional(),
    groupBy: z.string().regex(/^[a-z0-9_]+$/).optional(),
    orderBy: z
      .array(
        z
          .object({
            field: z.string().regex(/^[a-z0-9_]+$/),
            direction: z.enum(["asc", "desc"]),
          })
          .strict(),
      )
      .max(3)
      .default([]),
    rowLimit: z.number().int().min(1).max(MAX_GATEWAY_ROWS),
  })
  .strict();

export const gatewayIdentitySchema = z
  .object({
    organizationId: z.string().min(3).max(100),
    assertion: z.string().min(40).max(16_384),
  })
  .strict();

export const gatewayExecuteRequestSchema = z
  .object({
    protocolVersion: z.literal(GATEWAY_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    connectorId: z.string().min(3).max(100),
    identity: gatewayIdentitySchema,
    plan: gatewayQueryPlanSchema,
  })
  .strict();

export const gatewayCatalogRequestSchema = z
  .object({
    protocolVersion: z.literal(GATEWAY_PROTOCOL_VERSION),
    requestId: z.string().uuid(),
    connectorId: z.string().min(3).max(100),
    identity: gatewayIdentitySchema,
    purpose:z.enum(['onboarding','runtime']).optional(),
  })
  .strict();

const gatewayDecisionBaseSchema = z.object({
  protocolVersion: z.literal(GATEWAY_PROTOCOL_VERSION),
  requestId: z.string().uuid(),
  decisionId: z.string().min(8).max(160),
  connectorId: z.string().min(3).max(100),
  policyVersion: z.string().min(1).max(100),
  decidedAt: z.string().datetime(),
});

export const gatewayAllowResponseSchema = gatewayDecisionBaseSchema
  .extend({
    decision: z.literal("allow"),
    catalogVersion: z.string().min(1).max(100),
    identityVerified: z.boolean(),
    identityProvider: z.enum(["oidc", "secure_demo"]),
    identityIssuer: z.string().min(3).max(500),
    identityExpiresAt: z.string().datetime(),
    executedPlan: gatewayQueryPlanSchema,
    rows: z.array(z.record(z.string(), z.unknown())).max(MAX_GATEWAY_ROWS),
    maskedFields: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(30),
    returnedRows: z.number().int().min(0).max(MAX_GATEWAY_ROWS),
    maximumRows: z.number().int().min(1).max(MAX_GATEWAY_ROWS),
    resultScope: z.enum(["returned_records", "all_matching_records"]).optional(),
  })
  .strict();

export const gatewayDenyResponseSchema = gatewayDecisionBaseSchema
  .extend({
    decision: z.literal("deny"),
    reasonCode: z.enum([
      "connector_not_allowed",
      "catalog_version_mismatch",
      "entity_not_allowed",
      "field_not_allowed",
      "filter_not_allowed",
      "identity_assertion_expired",
      "identity_assertion_invalid",
      "identity_assertion_replayed",
      "identity_not_verified",
      "onboarding_not_allowed",
      "organization_not_allowed",
      "row_limit_exceeded",
      "sort_not_allowed",
    ]),
    reason: z.string().min(3).max(300),
  })
  .strict();

export const gatewayExecuteResponseSchema = z.discriminatedUnion("decision", [
  gatewayAllowResponseSchema,
  gatewayDenyResponseSchema,
]);

export const gatewayCatalogResponseSchema = gatewayDecisionBaseSchema
  .extend({
    decision: z.literal("allow"),
    identityVerified: z.literal(true),
    identityProvider: z.enum(["oidc", "secure_demo"]),
    identityIssuer: z.string().min(3).max(500),
    identityExpiresAt: z.string().datetime(),
    databaseEngine: z.literal("PostgreSQL"),
    connectionStatus: z.literal("ready"),
    catalogVersion: z.string().min(1).max(100),
    entities: z.array(semanticEntitySchema).min(1).max(12),
    relationships: z.array(semanticRelationshipSchema).max(30),
  })
  .strict();

export const gatewayCatalogResultSchema = z.union([
  gatewayCatalogResponseSchema,
  gatewayDenyResponseSchema,
]);

export const gatewayHealthResponseSchema = z
  .object({
    status: z.literal("healthy"),
    protocolVersion: z.literal(GATEWAY_PROTOCOL_VERSION),
    gatewayId: z.string().min(3).max(100),
    policyVersion: z.string().min(1).max(100),
    catalogVersion: z.string().min(1).max(100),
    checkedAt: z.string().datetime(),
  })
  .strict();

export type GatewayQueryPlan = z.infer<typeof gatewayQueryPlanSchema>;
export type GatewayAnalysis = z.infer<typeof gatewayAnalysisSchema>;
export type GatewayAggregateRow = z.infer<typeof gatewayAggregateRowSchema>;
export type GatewayIdentity = z.infer<typeof gatewayIdentitySchema>;
export type GatewayExecuteRequest = z.infer<
  typeof gatewayExecuteRequestSchema
>;
export type GatewayCatalogRequest = z.infer<
  typeof gatewayCatalogRequestSchema
>;
export type GatewayCatalogResponse = z.infer<
  typeof gatewayCatalogResponseSchema
>;
export type GatewayAllowResponse = z.infer<typeof gatewayAllowResponseSchema>;
export type GatewayDenyResponse = z.infer<typeof gatewayDenyResponseSchema>;
export type GatewayExecuteResponse = z.infer<
  typeof gatewayExecuteResponseSchema
>;
export type GatewayHealthResponse = z.infer<
  typeof gatewayHealthResponseSchema
>;
