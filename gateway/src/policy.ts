import { z } from "zod";
import {
  insuranceSemanticCatalog,
  semanticEntityNameSchema,
  semanticFilterOperatorSchema,
} from "../../lib/catalog/semantic.js";
import type {
  GatewayExecuteRequest,
  GatewayQueryPlan,
} from "../../lib/gateway/contract.js";
import type { VerifiedGatewayIdentity } from "./identity.js";

const entityPolicySchema = z
  .object({
    source: z.string().regex(/^[a-z0-9_]+$/),
    fields: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1).max(40),
    filterOperators: z.record(
      z.string().regex(/^[a-z0-9_]+$/),
      z.array(semanticFilterOperatorSchema).min(1),
    ),
    groupBy: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(10),
    sortBy: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(20),
    maximumRows: z.number().int().min(1).max(200),
  })
  .strict();

export const gatewayPolicySchema = z
  .object({
    version: z.string().min(1).max(100),
    catalogVersion: z.string().min(1).max(100),
    organizationId: z.string().min(3).max(100),
    connectorId: z.string().min(3).max(100),
    identities: z
      .object({
        users: z.record(
          z.string().email(),
          z.array(z.string().min(2).max(100)).min(1).max(20),
        ),
        emailDomains: z.record(
          z.string().min(3).max(200),
          z.array(z.string().min(2).max(100)).min(1).max(20),
        ),
      })
      .strict(),
    groups: z.record(
      z.string().min(2).max(100),
      z.array(semanticEntityNameSchema).min(1),
    ),
    onboardingAdminGroups: z.array(z.string().min(2).max(100)).min(1).max(20),
    entities: z
      .object({
        policies: entityPolicySchema,
        claims: entityPolicySchema,
        endorsements: entityPolicySchema,
      })
      .strict(),
    masking: z.record(
      z.string().regex(/^[a-z0-9_]+$/),
      z.enum(["partial", "redact"]),
    ),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.catalogVersion !== insuranceSemanticCatalog.catalogVersion) {
      context.addIssue({
        code: "custom",
        message: "The policy catalogVersion does not match this Gateway adapter.",
      });
    }
    for (const semantic of insuranceSemanticCatalog.entities) {
      const entity = policy.entities[semantic.entity];
      const semanticFields = new Map(
        semantic.fields.map((field) => [field.name, field]),
      );
      const allowedFields = new Set(entity.fields);
      if (!allowedFields.has(semantic.primaryKey)) {
        context.addIssue({
          code: "custom",
          message: `${semantic.entity} must permit its logical primary key.`,
        });
      }
      for (const field of entity.fields) {
        if (!semanticFields.has(field)) {
          context.addIssue({
            code: "custom",
            message: `${semantic.entity} permits an unknown field: ${field}.`,
          });
        }
      }
      for (const [field, operators] of Object.entries(entity.filterOperators)) {
        const semanticField = semanticFields.get(field);
        if (
          !allowedFields.has(field) ||
          !semanticField ||
          operators.some(
            (operator) => !semanticField.filterOperators.includes(operator),
          )
        ) {
          context.addIssue({
            code: "custom",
            message: `${semantic.entity} contains an invalid filter policy for ${field}.`,
          });
        }
      }
      for (const field of entity.groupBy) {
        if (!allowedFields.has(field) || !semanticFields.get(field)?.groupable) {
          context.addIssue({
            code: "custom",
            message: `${semantic.entity} cannot group by ${field}.`,
          });
        }
      }
      for (const field of entity.sortBy) {
        if (!allowedFields.has(field) || !semanticFields.get(field)?.sortable) {
          context.addIssue({
            code: "custom",
            message: `${semantic.entity} cannot sort by ${field}.`,
          });
        }
      }
    }
    const catalogFields = new Set(
      insuranceSemanticCatalog.entities.flatMap((entity) =>
        entity.fields.map((field) => field.name),
      ),
    );
    for (const field of Object.keys(policy.masking)) {
      if (!catalogFields.has(field)) {
        context.addIssue({
          code: "custom",
          message: `Masking policy references an unknown field: ${field}.`,
        });
      }
    }
  });

export type GatewayPolicy = z.infer<typeof gatewayPolicySchema>;
export type PolicyReasonCode =
  | "connector_not_allowed"
  | "catalog_version_mismatch"
  | "entity_not_allowed"
  | "field_not_allowed"
  | "filter_not_allowed"
  | "identity_assertion_expired"
  | "identity_assertion_invalid"
  | "identity_assertion_replayed"
  | "identity_not_verified"
  | "onboarding_not_allowed"
  | "organization_not_allowed"
  | "row_limit_exceeded"
  | "sort_not_allowed";

export type PolicyDecision =
  | { allowed: true; groups: string[]; entityPolicy: GatewayPolicy["entities"][keyof GatewayPolicy["entities"]] }
  | { allowed: false; reasonCode: PolicyReasonCode; reason: string };

export type OnboardingPolicyDecision =
  | { allowed: true; groups: string[] }
  | { allowed: false; reasonCode: PolicyReasonCode; reason: string };

export function evaluateOnboardingPolicy(
  request: Pick<GatewayExecuteRequest, "connectorId" | "identity">,
  policy: GatewayPolicy,
  identity: VerifiedGatewayIdentity,
): OnboardingPolicyDecision {
  if (
    request.identity.organizationId !== policy.organizationId ||
    identity.organizationId !== policy.organizationId
  ) {
    return deny(
      "organization_not_allowed",
      "The organization is not configured in this client Gateway.",
    );
  }
  if (request.connectorId !== policy.connectorId) {
    return deny(
      "connector_not_allowed",
      "The connector is not configured in this client Gateway.",
    );
  }
  const groups = resolveAuthoritativeGroups(identity.email, policy);
  if (!groups.length) {
    return deny(
      "identity_not_verified",
      "The client identity policy could not verify this user.",
    );
  }
  if (!groups.some((group) => policy.onboardingAdminGroups.includes(group))) {
    return deny(
      "onboarding_not_allowed",
      "The verified identity is not a connector onboarding administrator.",
    );
  }
  return { allowed: true, groups };
}

export function evaluatePolicy(
  request: GatewayExecuteRequest,
  policy: GatewayPolicy,
  identity: VerifiedGatewayIdentity,
): PolicyDecision {
  if (
    request.identity.organizationId !== policy.organizationId ||
    identity.organizationId !== policy.organizationId
  ) {
    return deny(
      "organization_not_allowed",
      "The organization is not configured in this client Gateway.",
    );
  }
  if (request.connectorId !== policy.connectorId) {
    return deny(
      "connector_not_allowed",
      "The connector is not configured in this client Gateway.",
    );
  }
  if (request.plan.catalogVersion !== policy.catalogVersion) {
    return deny(
      "catalog_version_mismatch",
      "The query plan was created from an outdated semantic catalog.",
    );
  }

  const groups = resolveAuthoritativeGroups(identity.email, policy);
  if (!groups.length) {
    return deny(
      "identity_not_verified",
      "The client identity policy could not verify this user.",
    );
  }

  const allowedEntities = new Set(
    groups.flatMap((group) => policy.groups[group] ?? []),
  );
  if (!allowedEntities.has(request.plan.entity)) {
    return deny(
      "entity_not_allowed",
      `The client policy does not grant this identity access to ${request.plan.entity}.`,
    );
  }

  const entityPolicy = policy.entities[request.plan.entity];
  if (request.plan.source !== entityPolicy.source) {
    return deny(
      "entity_not_allowed",
      "The requested source is not approved for this entity.",
    );
  }

  const allowedFields = new Set(entityPolicy.fields);
  const uniqueFields = new Set(request.plan.fields);
  const forbiddenField = request.plan.fields.find(
    (field) => !allowedFields.has(field),
  );
  if (forbiddenField || uniqueFields.size !== request.plan.fields.length) {
    return deny(
      "field_not_allowed",
      forbiddenField
        ? `Field ${forbiddenField} is not allowed by the client policy.`
        : "Duplicate fields are not permitted.",
    );
  }

  for (const filter of request.plan.filters) {
    const operators = entityPolicy.filterOperators[filter.field] ?? [];
    if (!operators.includes(filter.operator)) {
      return deny(
        "filter_not_allowed",
        `Filter ${filter.field}:${filter.operator} is not allowed by the client policy.`,
      );
    }
  }

  if (
    request.plan.groupBy &&
    !entityPolicy.groupBy.includes(request.plan.groupBy)
  ) {
    return deny(
      "filter_not_allowed",
      `Grouping by ${request.plan.groupBy} is not allowed by the client policy.`,
    );
  }
  const forbiddenSort = request.plan.orderBy.find(
    (sort) =>
      !allowedFields.has(sort.field) ||
      !entityPolicy.sortBy.includes(sort.field),
  );
  if (forbiddenSort) {
    return deny(
      "sort_not_allowed",
      `Sorting by ${forbiddenSort.field} is not allowed by the client policy.`,
    );
  }
  if (request.plan.rowLimit > entityPolicy.maximumRows) {
    return deny(
      "row_limit_exceeded",
      `The client policy limits this entity to ${entityPolicy.maximumRows} rows.`,
    );
  }

  return { allowed: true, groups, entityPolicy };
}

function resolveAuthoritativeGroups(email: string, policy: GatewayPolicy) {
  const normalized = email.trim().toLowerCase();
  const explicit = policy.identities.users[normalized];
  if (explicit) return explicit.filter((group) => policy.groups[group]);
  const domain = normalized.split("@")[1] ?? "";
  return (policy.identities.emailDomains[domain] ?? []).filter(
    (group) => policy.groups[group],
  );
}

function deny(reasonCode: PolicyReasonCode, reason: string): PolicyDecision {
  return { allowed: false, reasonCode, reason };
}

export function applyMasking(
  rows: Array<Record<string, unknown>>,
  plan: GatewayQueryPlan,
  policy: GatewayPolicy,
) {
  const maskedFields = plan.fields.filter((field) => policy.masking[field]);
  return {
    maskedFields,
    rows: rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([field, value]) => [
          field,
          maskValue(value, policy.masking[field]),
        ]),
      ),
    ),
  };
}

function maskValue(value: unknown, strategy: "partial" | "redact" | undefined) {
  if (!strategy || value === null || value === undefined) return value;
  if (strategy === "redact") return "[REDACTED]";
  const text = String(value).trim();
  return `${text.slice(0, 1).toUpperCase() || "C"}•••••• customer`;
}
