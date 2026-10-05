import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
};

export const organizations = sqliteTable(
  "organizations",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    dataRegion: text("data_region").notNull().default("india-west"),
    ...timestamps,
  },
  (table) => [uniqueIndex("organizations_slug_uidx").on(table.slug)],
);

export const appUsers = sqliteTable(
  "app_users",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    fullName: text("full_name").notNull(),
    role: text("role", { enum: ["admin", "member", "viewer"] })
      .notNull()
      .default("admin"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("app_users_org_email_uidx").on(
      table.organizationId,
      table.email,
    ),
    index("app_users_organization_idx").on(table.organizationId),
  ],
);

export const userPreferences = sqliteTable(
  "user_preferences",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    emailSafetyAlerts: integer("email_safety_alerts", {
      mode: "boolean",
    })
      .notNull()
      .default(true),
    defaultSection: text("default_section").notNull().default("workspaces"),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
);

export const dataConnectors = sqliteTable(
  "data_connectors",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    engine: text("engine").notNull(),
    privateHost: text("private_host").notNull(),
    databaseName: text("database_name").notNull(),
    region: text("region").notNull(),
    status: text("status", {
      enum: ["draft", "healthy", "unavailable"],
    })
      .notNull()
      .default("draft"),
    lastCheckedAt: text("last_checked_at"),
    ...timestamps,
  },
  (table) => [index("data_connectors_organization_idx").on(table.organizationId)],
);

export const connectorPermissions = sqliteTable(
  "connector_permissions",
  {
    id: text("id").primaryKey(),
    connectorId: text("connector_id")
      .notNull()
      .references(() => dataConnectors.id, { onDelete: "cascade" }),
    tableName: text("table_name").notNull(),
    allowedFieldsJson: text("allowed_fields_json").notNull().default("[]"),
    maskedFieldsJson: text("masked_fields_json").notNull().default("[]"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("connector_permissions_table_uidx").on(
      table.connectorId,
      table.tableName,
    ),
    index("connector_permissions_connector_idx").on(table.connectorId),
  ],
);

export const catalogSnapshots = sqliteTable(
  "catalog_snapshots",
  {
    id: text("id").primaryKey(),
    connectorId: text("connector_id")
      .notNull()
      .references(() => dataConnectors.id, { onDelete: "cascade" }),
    catalogVersion: text("catalog_version").notNull(),
    policyVersion: text("policy_version").notNull(),
    status: text("status", { enum: ["active", "superseded"] }).notNull().default("active"),
    entityCount: integer("entity_count").notNull(),
    fieldCount: integer("field_count").notNull(),
    validationJson: text("validation_json").notNull().default("{}"),
    syncedAt: text("synced_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("catalog_snapshots_connector_version_uidx").on(
      table.connectorId,
      table.catalogVersion,
    ),
    index("catalog_snapshots_connector_status_idx").on(table.connectorId, table.status),
  ],
);

export const catalogEntities = sqliteTable(
  "catalog_entities",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id").notNull().references(() => catalogSnapshots.id, { onDelete: "cascade" }),
    entityName: text("entity_name").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    sourceName: text("source_name").notNull(),
    primaryKey: text("primary_key").notNull(),
    dateField: text("date_field"),
    amountField: text("amount_field"),
    statusField: text("status_field"),
    maximumRows: integer("maximum_rows").notNull(),
    synonymsJson: text("synonyms_json").notNull().default("[]"),
    defaultFieldsJson: text("default_fields_json").notNull().default("[]"),
  },
  (table) => [
    uniqueIndex("catalog_entities_snapshot_name_uidx").on(table.snapshotId, table.entityName),
  ],
);

export const catalogFields = sqliteTable(
  "catalog_fields",
  {
    id: text("id").primaryKey(),
    catalogEntityId: text("catalog_entity_id").notNull().references(() => catalogEntities.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    dataType: text("data_type").notNull(),
    semanticType: text("semantic_type").notNull(),
    displayFormat: text("display_format").notNull(),
    sensitivity: text("sensitivity").notNull(),
    masked: integer("masked", { mode: "boolean" }).notNull().default(false),
    groupable: integer("groupable", { mode: "boolean" }).notNull().default(false),
    sortable: integer("sortable", { mode: "boolean" }).notNull().default(false),
    synonymsJson: text("synonyms_json").notNull().default("[]"),
    filterOperatorsJson: text("filter_operators_json").notNull().default("[]"),
    aggregationsJson: text("aggregations_json").notNull().default("[]"),
  },
  (table) => [
    uniqueIndex("catalog_fields_entity_name_uidx").on(table.catalogEntityId, table.fieldName),
  ],
);

export const catalogMetrics = sqliteTable(
  "catalog_metrics",
  {
    id: text("id").primaryKey(),
    catalogEntityId: text("catalog_entity_id").notNull().references(() => catalogEntities.id, { onDelete: "cascade" }),
    metricName: text("metric_name").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull(),
    operation: text("operation").notNull(),
    fieldName: text("field_name"),
    displayFormat: text("display_format").notNull(),
  },
  (table) => [uniqueIndex("catalog_metrics_entity_name_uidx").on(table.catalogEntityId, table.metricName)],
);

export const catalogRelationships = sqliteTable(
  "catalog_relationships",
  {
    id: text("id").primaryKey(),
    snapshotId: text("snapshot_id").notNull().references(() => catalogSnapshots.id, { onDelete: "cascade" }),
    relationshipName: text("relationship_name").notNull(),
    fromEntity: text("from_entity").notNull(),
    fromField: text("from_field").notNull(),
    toEntity: text("to_entity").notNull(),
    toField: text("to_field").notNull(),
    relationshipKind: text("relationship_kind").notNull(),
    label: text("label").notNull(),
  },
  (table) => [uniqueIndex("catalog_relationships_snapshot_name_uidx").on(table.snapshotId, table.relationshipName)],
);

export const accessRules = sqliteTable(
  "access_rules",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    datasetScope: text("dataset_scope").notNull(),
    permittedFieldCount: integer("permitted_field_count").notNull(),
    accessMode: text("access_mode").notNull().default("read_only"),
    teamName: text("team_name").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "restrict" }),
    ...timestamps,
  },
  (table) => [
    index("access_rules_organization_idx").on(table.organizationId),
    uniqueIndex("access_rules_org_name_uidx").on(
      table.organizationId,
      table.name,
    ),
  ],
);

export const savedWorkspaces = sqliteTable(
  "saved_workspaces",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    prompt: text("prompt").notNull(),
    intent: text("intent"),
    sourceMode: text("source_mode"),
    workspaceJson: text("workspace_json"),
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    lastOpenedAt: text("last_opened_at"),
    ...timestamps,
  },
  (table) => [
    index("saved_workspaces_owner_idx").on(table.ownerUserId),
    uniqueIndex("saved_workspaces_owner_prompt_uidx").on(
      table.ownerUserId,
      table.prompt,
    ),
  ],
);

export const workspaceRuns = sqliteTable(
  "workspace_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => appUsers.id, { onDelete: "cascade" }),
    savedWorkspaceId: text("saved_workspace_id").references(
      () => savedWorkspaces.id,
      { onDelete: "set null" },
    ),
    prompt: text("prompt").notNull(),
    intent: text("intent"),
    queryPlanJson: text("query_plan_json"),
    resultMetadataJson: text("result_metadata_json"),
    catalogVersion: text("catalog_version"),
    policyVersion: text("policy_version"),
    decisionId: text("decision_id"),
    resultCount: integer("result_count"),
    status: text("status", { enum: ["succeeded", "failed", "denied"] })
      .notNull(),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    index("workspace_runs_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
    index("workspace_runs_user_created_idx").on(table.userId, table.createdAt),
  ],
);

export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => appUsers.id, {
      onDelete: "set null",
    }),
    actorLabel: text("actor_label").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    outcome: text("outcome", { enum: ["success", "denied", "failure"] })
      .notNull(),
    requestId: text("request_id").notNull(),
    detailsJson: text("details_json").notNull().default("{}"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [
    uniqueIndex("audit_events_request_uidx").on(table.requestId),
    index("audit_events_organization_created_idx").on(
      table.organizationId,
      table.createdAt,
    ),
  ],
);
