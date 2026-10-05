import { z } from "zod";

export const semanticEntityNameSchema = z.enum([
  "policies",
  "claims",
  "endorsements",
]);

export const semanticFilterOperatorSchema = z.enum([
  "after",
  "before",
  "between",
  "current_month",
  "equals",
  "greater_than",
  "in",
  "less_than",
]);

export const semanticValueSetSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1).max(100),
    description: z.string().min(1).max(240),
    values: z.array(z.string().min(1).max(100)).min(1).max(30),
  })
  .strict();

export const semanticFieldSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1).max(100),
    description: z.string().min(1).max(240),
    dataType: z.enum(["string", "number", "date"]),
    semanticType: z.enum([
      "amount",
      "category",
      "date",
      "identifier",
      "person",
      "percentage",
      "status",
      "text",
    ]),
    format: z.enum([
      "badge",
      "currency",
      "date",
      "id",
      "number",
      "percentage",
      "person",
      "text",
    ]),
    synonyms: z.array(z.string().min(1).max(80)).max(12),
    allowedValues: z.array(z.string().min(1).max(100)).max(60),
    valueSets: z.array(semanticValueSetSchema).max(12),
    filterOperators: z.array(semanticFilterOperatorSchema).max(8),
    aggregations: z.array(z.enum(["average", "count", "sum"])).max(3),
    groupable: z.boolean(),
    sortable: z.boolean(),
    sensitivity: z.enum(["public", "internal", "confidential", "restricted"]),
    masked: z.boolean(),
  })
  .strict();

export const semanticMetricSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    label: z.string().min(1).max(100),
    description: z.string().min(1).max(240),
    operation: z.enum(["average", "count", "sum"]),
    field: z.string().regex(/^[a-z0-9_]+$/).nullable(),
    format: z.enum(["currency", "number", "percentage"]),
  })
  .strict();

export const semanticEntitySchema = z
  .object({
    entity: semanticEntityNameSchema,
    label: z.string().min(1).max(100),
    description: z.string().min(1).max(300),
    synonyms: z.array(z.string().min(1).max(80)).min(1).max(20),
    source: z.string().regex(/^[a-z0-9_]+$/),
    primaryKey: z.string().regex(/^[a-z0-9_]+$/),
    defaultFields: z.array(z.string().regex(/^[a-z0-9_]+$/)).min(1).max(20),
    dateField: z.string().regex(/^[a-z0-9_]+$/).nullable(),
    amountField: z.string().regex(/^[a-z0-9_]+$/).nullable(),
    statusField: z.string().regex(/^[a-z0-9_]+$/).nullable(),
    maximumRows: z.number().int().min(1).max(200),
    accessMode: z.literal("read_only"),
    schemaVerified: z.literal(true),
    fields: z.array(semanticFieldSchema).min(1).max(40),
    metrics: z.array(semanticMetricSchema).min(1).max(12),
  })
  .strict();

export const semanticRelationshipSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    fromEntity: semanticEntityNameSchema,
    fromField: z.string().regex(/^[a-z0-9_]+$/),
    toEntity: semanticEntityNameSchema,
    toField: z.string().regex(/^[a-z0-9_]+$/),
    kind: z.enum(["many_to_one", "one_to_many", "one_to_one"]),
    label: z.string().min(1).max(120),
  })
  .strict();

export const semanticCatalogSchema = z
  .object({
    catalogVersion: z.string().min(1).max(100),
    entities: z.array(semanticEntitySchema).min(1).max(12),
    relationships: z.array(semanticRelationshipSchema).max(30),
  })
  .strict()
  .superRefine((catalog, context) => {
    const entityNames = new Set(catalog.entities.map((entity) => entity.entity));
    if (entityNames.size !== catalog.entities.length) {
      context.addIssue({ code: "custom", message: "Catalog entity names must be unique." });
    }

    for (const entity of catalog.entities) {
      const fields = new Set(entity.fields.map((field) => field.name));
      if (fields.size !== entity.fields.length) {
        context.addIssue({
          code: "custom",
          message: `${entity.entity} contains duplicate fields.`,
        });
      }
      const referencedFields = [
        entity.primaryKey,
        ...entity.defaultFields,
        entity.dateField,
        entity.amountField,
        entity.statusField,
        ...entity.metrics.map((metric) => metric.field),
      ].filter((field): field is string => Boolean(field));
      for (const field of referencedFields) {
        if (!fields.has(field)) {
          context.addIssue({
            code: "custom",
            message: `${entity.entity} references an unknown field: ${field}.`,
          });
        }
      }
      for (const field of entity.fields) {
        const allowedValues = new Set(field.allowedValues);
        const valueSetIds = new Set(field.valueSets.map((valueSet) => valueSet.id));
        if (valueSetIds.size !== field.valueSets.length) {
          context.addIssue({
            code: "custom",
            message: `${entity.entity}.${field.name} contains duplicate value-set IDs.`,
          });
        }
        for (const valueSet of field.valueSets) {
          if (valueSet.values.some((value) => !allowedValues.has(value))) {
            context.addIssue({
              code: "custom",
              message: `${entity.entity}.${field.name} value set ${valueSet.id} contains a value outside allowedValues.`,
            });
          }
        }
      }
    }

    for (const relationship of catalog.relationships) {
      const from = catalog.entities.find(
        (entity) => entity.entity === relationship.fromEntity,
      );
      const to = catalog.entities.find(
        (entity) => entity.entity === relationship.toEntity,
      );
      if (
        !from?.fields.some((field) => field.name === relationship.fromField) ||
        !to?.fields.some((field) => field.name === relationship.toField)
      ) {
        context.addIssue({
          code: "custom",
          message: `Relationship ${relationship.id} references an unknown field.`,
        });
      }
    }
  });

export type SemanticField = z.infer<typeof semanticFieldSchema>;
export type SemanticValueSet = z.infer<typeof semanticValueSetSchema>;
export type SemanticMetric = z.infer<typeof semanticMetricSchema>;
export type SemanticEntity = z.infer<typeof semanticEntitySchema>;
export type SemanticRelationship = z.infer<typeof semanticRelationshipSchema>;
export type SemanticCatalog = z.infer<typeof semanticCatalogSchema>;

const field = (
  value: Omit<SemanticField, "synonyms" | "allowedValues" | "valueSets" | "filterOperators" | "aggregations"> & {
    synonyms?: string[];
    allowedValues?: string[];
    valueSets?: SemanticField["valueSets"];
    filterOperators?: SemanticField["filterOperators"];
    aggregations?: SemanticField["aggregations"];
  },
): SemanticField => ({
  synonyms: [],
  allowedValues: [],
  valueSets: [],
  filterOperators: [],
  aggregations: [],
  ...value,
});

export const insuranceSemanticCatalog: SemanticCatalog = semanticCatalogSchema.parse({
  catalogVersion: "insurance-catalog-2026-09-01",
  entities: [
    {
      entity: "policies",
      label: "Policies and renewals",
      description:
        "Active and expiring motor policies, premium, ownership and renewal pipeline data.",
      synonyms: [
        "policy",
        "policies",
        "portfolio",
        "book of business",
        "renewal",
        "renewals",
        "expiring",
        "premium",
      ],
      source: "policies_read_replica",
      primaryKey: "policy_number",
      defaultFields: [
        "policy_number",
        "customer_name",
        "product",
        "branch",
        "relationship_manager",
        "expiry_date",
        "total_premium",
        "status",
      ],
      dateField: "expiry_date",
      amountField: "total_premium",
      statusField: "status",
      maximumRows: 200,
      accessMode: "read_only",
      schemaVerified: true,
      fields: [
        field({ name: "policy_number", label: "Policy", description: "Client policy identifier.", dataType: "string", semanticType: "identifier", format: "id", sensitivity: "internal", masked: false, sortable: true, groupable: false, synonyms: ["policy no", "policy number"] }),
        field({ name: "customer_name", label: "Customer", description: "Masked policyholder display name.", dataType: "string", semanticType: "person", format: "person", sensitivity: "confidential", masked: true, sortable: true, groupable: false, synonyms: ["policyholder", "insured"] }),
        field({ name: "product", label: "Product", description: "Motor insurance product.", dataType: "string", semanticType: "category", format: "text", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"], synonyms: ["plan", "line of business"], allowedValues: ["comprehensive", "third_party", "own_damage"] }),
        field({ name: "branch", label: "Branch", description: "Servicing insurance branch.", dataType: "string", semanticType: "category", format: "text", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"], synonyms: ["office", "location"] }),
        field({ name: "relationship_manager", label: "Relationship manager", description: "Employee responsible for the policy.", dataType: "string", semanticType: "person", format: "person", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"], synonyms: ["rm", "manager", "owner"] }),
        field({ name: "start_date", label: "Start date", description: "Policy coverage start date.", dataType: "date", semanticType: "date", format: "date", sensitivity: "internal", masked: false, sortable: true, groupable: false, filterOperators: ["after", "before", "between"] }),
        field({ name: "expiry_date", label: "Expiry", description: "Policy coverage expiry date.", dataType: "date", semanticType: "date", format: "date", sensitivity: "internal", masked: false, sortable: true, groupable: false, filterOperators: ["after", "before", "between"], synonyms: ["renewal date", "due date"] }),
        field({ name: "total_premium", label: "Premium", description: "Total written premium including tax.", dataType: "number", semanticType: "amount", format: "currency", sensitivity: "confidential", masked: false, sortable: true, groupable: false, filterOperators: ["greater_than", "less_than"], aggregations: ["sum", "average"], synonyms: ["written premium", "premium amount"] }),
        field({ name: "status", label: "Policy status", description: "Current policy lifecycle status.", dataType: "string", semanticType: "status", format: "badge", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"], allowedValues: ["active", "expired", "cancelled"], valueSets: [{ id: "active", label: "Active policies", description: "Policies currently in force.", values: ["active"] }] }),
        field({ name: "renewal_status", label: "Renewal status", description: "Current renewal workflow status.", dataType: "string", semanticType: "status", format: "badge", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"], synonyms: ["renewal stage"], allowedValues: ["due", "contacted", "quoted", "renewed", "lapsed"], valueSets: [{ id: "open", label: "Open renewals", description: "Renewals that still require action.", values: ["due", "contacted", "quoted"] }] }),
        field({ name: "propensity_score", label: "Renewal propensity", description: "Synthetic renewal likelihood score.", dataType: "number", semanticType: "percentage", format: "percentage", sensitivity: "internal", masked: false, sortable: true, groupable: false, filterOperators: ["greater_than", "less_than"], aggregations: ["average"], synonyms: ["likelihood", "conversion score"] }),
      ],
      metrics: [
        { id: "policy_count", label: "Policies", description: "Number of policies returned.", operation: "count", field: null, format: "number" },
        { id: "written_premium", label: "Written premium", description: "Total premium in the approved result.", operation: "sum", field: "total_premium", format: "currency" },
        { id: "average_premium", label: "Average premium", description: "Average premium per returned policy.", operation: "average", field: "total_premium", format: "currency" },
      ],
    },
    {
      entity: "claims",
      label: "Claims",
      description: "Motor claim exposure, approvals, status, cause and branch workload.",
      synonyms: ["claim", "claims", "loss", "settlement", "surveyor", "incident"],
      source: "claims_read_replica",
      primaryKey: "claim_number",
      defaultFields: ["claim_number", "policy_number", "customer_name", "branch", "intimation_date", "claimed_amount", "approved_amount", "status", "cause"],
      dateField: "intimation_date",
      amountField: "claimed_amount",
      statusField: "status",
      maximumRows: 200,
      accessMode: "read_only",
      schemaVerified: true,
      fields: [
        field({ name: "claim_number", label: "Claim", description: "Client claim identifier.", dataType: "string", semanticType: "identifier", format: "id", sensitivity: "internal", masked: false, sortable: true, groupable: false, synonyms: ["claim no", "claim number"] }),
        field({ name: "policy_number", label: "Policy", description: "Related policy identifier.", dataType: "string", semanticType: "identifier", format: "id", sensitivity: "internal", masked: false, sortable: true, groupable: false }),
        field({ name: "customer_name", label: "Customer", description: "Masked policyholder display name.", dataType: "string", semanticType: "person", format: "person", sensitivity: "confidential", masked: true, sortable: true, groupable: false }),
        field({ name: "branch", label: "Branch", description: "Claim handling branch.", dataType: "string", semanticType: "category", format: "text", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"], synonyms: ["office", "location"] }),
        field({ name: "intimation_date", label: "Reported", description: "Date the claim was reported.", dataType: "date", semanticType: "date", format: "date", sensitivity: "internal", masked: false, sortable: true, groupable: false, filterOperators: ["after", "before", "between", "current_month"], synonyms: ["reported date", "intimated"] }),
        field({ name: "claimed_amount", label: "Claimed", description: "Amount requested by the claimant.", dataType: "number", semanticType: "amount", format: "currency", sensitivity: "confidential", masked: false, sortable: true, groupable: false, filterOperators: ["greater_than", "less_than"], aggregations: ["sum", "average"], synonyms: ["claim exposure", "loss amount"] }),
        field({ name: "approved_amount", label: "Approved", description: "Amount approved so far.", dataType: "number", semanticType: "amount", format: "currency", sensitivity: "confidential", masked: false, sortable: true, groupable: false, filterOperators: ["greater_than", "less_than"], aggregations: ["sum", "average"] }),
        field({ name: "status", label: "Claim status", description: "Current claim lifecycle status.", dataType: "string", semanticType: "status", format: "badge", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"], synonyms: ["stage", "pending"], allowedValues: ["intimated", "documents_pending", "under_assessment", "approved", "settled"], valueSets: [{ id: "open", label: "Open claims", description: "Claims that are not yet settled.", values: ["intimated", "documents_pending", "under_assessment", "approved"] }] }),
        field({ name: "cause", label: "Cause", description: "Recorded cause of loss.", dataType: "string", semanticType: "text", format: "text", sensitivity: "internal", masked: false, sortable: false, groupable: true, filterOperators: ["equals", "in"] }),
      ],
      metrics: [
        { id: "claim_count", label: "Claims", description: "Number of claims returned.", operation: "count", field: null, format: "number" },
        { id: "claim_exposure", label: "Claim exposure", description: "Total amount claimed.", operation: "sum", field: "claimed_amount", format: "currency" },
        { id: "approved_amount", label: "Approved so far", description: "Total amount approved.", operation: "sum", field: "approved_amount", format: "currency" },
      ],
    },
    {
      entity: "endorsements",
      label: "Endorsements",
      description: "Policy amendment requests, workflow status and premium impact.",
      synonyms: ["endorsement", "endorsements", "amendment", "address change", "name correction", "hypothecation"],
      source: "endorsements_read_replica",
      primaryKey: "endorsement_number",
      defaultFields: ["endorsement_number", "policy_number", "customer_name", "type", "status", "requested_at", "effective_date", "premium_delta", "branch"],
      dateField: "requested_at",
      amountField: "premium_delta",
      statusField: "status",
      maximumRows: 200,
      accessMode: "read_only",
      schemaVerified: true,
      fields: [
        field({ name: "endorsement_number", label: "Endorsement", description: "Client endorsement identifier.", dataType: "string", semanticType: "identifier", format: "id", sensitivity: "internal", masked: false, sortable: true, groupable: false }),
        field({ name: "policy_number", label: "Policy", description: "Related policy identifier.", dataType: "string", semanticType: "identifier", format: "id", sensitivity: "internal", masked: false, sortable: true, groupable: false }),
        field({ name: "customer_name", label: "Customer", description: "Masked policyholder display name.", dataType: "string", semanticType: "person", format: "person", sensitivity: "confidential", masked: true, sortable: true, groupable: false }),
        field({ name: "type", label: "Type", description: "Requested policy amendment type.", dataType: "string", semanticType: "category", format: "text", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"], synonyms: ["request type", "change type"], allowedValues: ["address_change", "vehicle_transfer", "hypothecation_add", "coverage_change"] }),
        field({ name: "status", label: "Status", description: "Current endorsement workflow status.", dataType: "string", semanticType: "status", format: "badge", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"], synonyms: ["stage", "pending"], allowedValues: ["requested", "documents_pending", "under_review", "approved"], valueSets: [{ id: "pending", label: "Pending endorsements", description: "Requests that have not yet been approved.", values: ["requested", "documents_pending", "under_review"] }] }),
        field({ name: "requested_at", label: "Requested", description: "Date the endorsement was requested.", dataType: "date", semanticType: "date", format: "date", sensitivity: "internal", masked: false, sortable: true, groupable: false, filterOperators: ["after", "before", "between", "current_month"] }),
        field({ name: "effective_date", label: "Effective date", description: "Date the requested change takes effect.", dataType: "date", semanticType: "date", format: "date", sensitivity: "internal", masked: false, sortable: true, groupable: false, filterOperators: ["after", "before", "between"] }),
        field({ name: "premium_delta", label: "Premium impact", description: "Premium difference caused by the endorsement.", dataType: "number", semanticType: "amount", format: "currency", sensitivity: "confidential", masked: false, sortable: true, groupable: false, filterOperators: ["greater_than", "less_than"], aggregations: ["sum", "average"], synonyms: ["premium change", "premium delta"] }),
        field({ name: "branch", label: "Branch", description: "Policy servicing branch.", dataType: "string", semanticType: "category", format: "text", sensitivity: "internal", masked: false, sortable: true, groupable: true, filterOperators: ["equals", "in"] }),
      ],
      metrics: [
        { id: "endorsement_count", label: "Open requests", description: "Number of endorsement requests returned.", operation: "count", field: null, format: "number" },
        { id: "premium_impact", label: "Premium impact", description: "Total premium difference.", operation: "sum", field: "premium_delta", format: "currency" },
        { id: "average_impact", label: "Average impact", description: "Average premium difference per request.", operation: "average", field: "premium_delta", format: "currency" },
      ],
    },
  ],
  relationships: [
    { id: "claims_to_policies", fromEntity: "claims", fromField: "policy_number", toEntity: "policies", toField: "policy_number", kind: "many_to_one", label: "Claim belongs to policy" },
    { id: "endorsements_to_policies", fromEntity: "endorsements", fromField: "policy_number", toEntity: "policies", toField: "policy_number", kind: "many_to_one", label: "Endorsement changes policy" },
  ],
});

export function findSemanticEntity(entity: string, catalog = insuranceSemanticCatalog) {
  return catalog.entities.find((candidate) => candidate.entity === entity);
}
