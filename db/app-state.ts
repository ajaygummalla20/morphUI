import { env } from "cloudflare:workers";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { demoMode, requireSession } from '@/lib/auth/session';
import { SecurityError, assertRole } from '@/lib/server/security';
import { drizzle } from "drizzle-orm/d1";
import type { BatchItem } from 'drizzle-orm/batch';
import type { DynamicWorkspaceResponse } from "@/lib/workspaces/dynamic";
import {
  insuranceSemanticCatalog,
  semanticCatalogSchema,
  type SemanticCatalog,
} from "@/lib/catalog/semantic";
import type {
  AccessRuleRecord,
  AppStateBootstrap,
  AuditEventRecord,
  ConnectorRecord,
  SavedWorkspaceRecord,
} from "@/lib/app-state/types";
import * as schema from "./app-state-schema";

const DEFAULT_ORGANIZATION_ID = "org_atlas_insurance";
const DEFAULT_CONNECTOR_ID = "connector_production_postgresql";

export type AppActor = {
  id: string;
  organizationId: string;
  email: string;
  fullName: string;
  role: "admin" | "member" | "viewer";
};

export function getAppStateDb() {
  const bindings = env as Cloudflare.Env & { DB?: D1Database };
  if (!bindings.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set d1 to DB in .openai/hosting.json.",
    );
  }
  return drizzle(bindings.DB, { schema });
}

export async function ensureAppActor(request: Request): Promise<AppActor> {
  const session = await requireSession(request);
  if (!demoMode()) return session;
  const db = getAppStateDb();
  const email = session.email;
  const fullName = session.fullName;

  await db
    .insert(schema.organizations)
    .values({
      id: DEFAULT_ORGANIZATION_ID,
      slug: "atlas-insurance",
      name: "Atlas Insurance",
      dataRegion: "india-west",
    })
    .onConflictDoNothing();

  const existing = await db.query.appUsers.findFirst({
    where: and(
      eq(schema.appUsers.organizationId, DEFAULT_ORGANIZATION_ID),
      eq(schema.appUsers.email, email),
    ),
  });
  const userId = existing?.id ?? crypto.randomUUID();

  if (!existing) {
    await db.insert(schema.appUsers).values({
      id: userId,
      organizationId: DEFAULT_ORGANIZATION_ID,
      email,
      fullName,
      role: "admin",
    });
  }

  await db
    .insert(schema.userPreferences)
    .values({ userId, emailSafetyAlerts: true, defaultSection: "workspaces" })
    .onConflictDoNothing();

  await seedOrganization(db, userId);
  const actor: AppActor = {
    id: userId,
    organizationId: DEFAULT_ORGANIZATION_ID,
    email,
    fullName: existing?.fullName ?? fullName,
    role: existing?.role ?? "admin",
  };
  const seededCatalog = await db.query.catalogSnapshots.findFirst({
    where: eq(schema.catalogSnapshots.connectorId, DEFAULT_CONNECTOR_ID),
  });
  if (!seededCatalog) {
    await activateConnector(actor, {
      connector: {
        id: DEFAULT_CONNECTOR_ID,
        name: "Production PostgreSQL",
        engine: "PostgreSQL",
        host: "customer-network",
        databaseName: "insurance_operations",
        region: "Mumbai",
        status: "healthy",
        lastCheckedAt: new Date().toISOString(),
      },
      catalog: insuranceSemanticCatalog,
      selectedEntities: insuranceSemanticCatalog.entities.map((entity) => entity.entity),
      policyVersion: "atlas-demo-policy-2026-08-12",
    });
  }
  return actor;
}

export async function loadAppState(actor: AppActor): Promise<AppStateBootstrap> {
  const db = getAppStateDb();
  const [organization, workspaces, rules, connectors, permissions, preferences, events] =
    await Promise.all([
      db.query.organizations.findFirst({
        where: eq(schema.organizations.id, actor.organizationId),
      }),
      db.query.savedWorkspaces.findMany({
        where: and(eq(schema.savedWorkspaces.organizationId,actor.organizationId),or(eq(schema.savedWorkspaces.ownerUserId, actor.id),eq(schema.savedWorkspaces.shared,true))),
        orderBy: [desc(schema.savedWorkspaces.updatedAt)],
        limit: 50,
      }),
      db.query.accessRules.findMany({
        where: eq(schema.accessRules.organizationId, actor.organizationId),
        orderBy: [schema.accessRules.name],
      }),
      db.query.dataConnectors.findMany({
        where: eq(schema.dataConnectors.organizationId, actor.organizationId),
        orderBy: [desc(schema.dataConnectors.updatedAt)],
      }),
      db.query.connectorPermissions.findMany({where:inArray(schema.connectorPermissions.connectorId,db.select({id:schema.dataConnectors.id}).from(schema.dataConnectors).where(eq(schema.dataConnectors.organizationId,actor.organizationId)))}),
      db.query.userPreferences.findFirst({
        where: eq(schema.userPreferences.userId, actor.id),
      }),
      db.query.auditEvents.findMany({
        where: and(eq(schema.auditEvents.organizationId, actor.organizationId),actor.role === 'admin' ? undefined : eq(schema.auditEvents.actorUserId,actor.id)),
        orderBy: [desc(schema.auditEvents.createdAt)],
        limit: 100,
      }),
    ]);

  if (!organization) throw new Error("The active organization was not initialized.");

  const activeConnector = connectors.find(
    (connector) => connector.status === "healthy",
  );

  return {
    mode: "cloud",
    organization: {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      dataRegion: organization.dataRegion,
    },
    user: {
      id: actor.id,
      email: actor.email,
      fullName: actor.fullName,
      role: actor.role,
    },
    savedWorkspaces: workspaces.map(row=>({...mapSavedWorkspace(row),canEdit:row.ownerUserId === actor.id})),
    accessRules: rules.map(mapAccessRule),
    connectors: connectors.map(mapConnector),
    approvedTables: permissions
      .filter(
        (permission) =>
          permission.enabled &&
          permission.connectorId ===
            activeConnector?.id,
      )
      .map((permission) => permission.tableName),
    preferences: {
      emailSafetyAlerts: preferences?.emailSafetyAlerts ?? true,
      defaultSection: preferences?.defaultSection ?? "workspaces",
    },
    auditEvents: events.map(mapAuditEvent),
  };
}

export async function saveWorkspace(
  actor: AppActor,
  workspace: SavedWorkspaceRecord,
) {
  assertRole(actor.role,'member');
  const db = getAppStateDb();
  await db
    .insert(schema.savedWorkspaces)
    .values({
      id: workspace.id,
      organizationId: actor.organizationId,
      ownerUserId: actor.id,
      title: workspace.title,
      prompt: workspace.prompt,
      intent: workspace.data?.intent ?? null,
      sourceMode: workspace.data?.sourceMode ?? null,
      workspaceJson: null,
      pinned: workspace.pinned,
      lastOpenedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [schema.savedWorkspaces.ownerUserId, schema.savedWorkspaces.prompt],
      set: {
        title: workspace.title,
        intent: workspace.data?.intent ?? null,
        sourceMode: workspace.data?.sourceMode ?? null,
        workspaceJson: null,
        pinned: workspace.pinned,
        updatedAt: new Date().toISOString(),
      },
    });
  await recordAudit(actor, {
    action: "Workspace saved",
    target: workspace.title,
    outcome: "success",
    requestId: `req_${crypto.randomUUID()}`,
    details: { sourceMode: workspace.data?.sourceMode },
  });
}

export async function replaceRules(
  actor: AppActor,
  rules: AccessRuleRecord[],
) {
  assertRole(actor.role,'admin');
  const db = getAppStateDb();
  const deletion = db
    .delete(schema.accessRules)
    .where(eq(schema.accessRules.organizationId, actor.organizationId));
  if (rules.length) {
    await db.batch([deletion,db.insert(schema.accessRules).values(
      rules.map((rule) => ({
        id: crypto.randomUUID(),
        organizationId: actor.organizationId,
        name: rule.name,
        datasetScope: rule.scope,
        permittedFieldCount: parseInt(rule.fields, 10),
        accessMode: "read_only",
        teamName: rule.users,
        enabled: rule.enabled,
        createdByUserId: actor.id,
      })),
    )]);
  } else await deletion;
  await recordAudit(actor, {
    action: "Access rules updated",
    target: `${rules.length} organization rules`,
    outcome: "success",
    requestId: `req_${crypto.randomUUID()}`,
    details: { ruleIds: rules.map((rule) => rule.id) },
  });
}

export async function addConnector(actor: AppActor, connector: ConnectorRecord) {
  assertRole(actor.role,'admin');
  const db = getAppStateDb();
  await db.insert(schema.dataConnectors).values({
    id: connector.id,
    organizationId: actor.organizationId,
    createdByUserId: actor.id,
    name: connector.name,
    engine: connector.engine,
    privateHost: connector.host,
    databaseName: connector.databaseName,
    region: connector.region,
    status: 'draft',
    lastCheckedAt: null,
  });
  await recordAudit(actor, {
    action:
      connector.status === "healthy"
        ? "Connector activated"
        : "Connector draft saved",
    target: connector.name,
    outcome: "success",
    requestId: `req_${crypto.randomUUID()}`,
    details: {
      engine: connector.engine,
      region: connector.region,
      status: connector.status,
    },
  });
}

export async function setConnectorPermissions(
  actor: AppActor,
  connectorId: string,
  tables: string[],
) {
  assertRole(actor.role,'admin');
  const db = getAppStateDb();
  const connector = await db.query.dataConnectors.findFirst({
    where: and(
      eq(schema.dataConnectors.id, connectorId),
      eq(schema.dataConnectors.organizationId, actor.organizationId),
    ),
  });
  if (!connector) throw new SecurityError(404,'connector_not_found',"Connector not found in the active organization.");

  const deletion = db
    .delete(schema.connectorPermissions)
    .where(eq(schema.connectorPermissions.connectorId, connectorId));
  if (tables.length) {
    await db.batch([deletion,db.insert(schema.connectorPermissions).values(
      tables.map((tableName) => ({
        id: crypto.randomUUID(),
        connectorId,
        tableName,
        allowedFieldsJson: "[]",
        maskedFieldsJson: "[]",
        enabled: true,
      })),
    )]);
  } else await deletion;
  await recordAudit(actor, {
    action: "Connector permissions updated",
    target: connector.name,
    outcome: "success",
    requestId: `req_${crypto.randomUUID()}`,
    details: { tables },
  });
}

export async function activateConnector(
  actor: AppActor,
  input: {
    connector: ConnectorRecord;
    catalog: SemanticCatalog;
    selectedEntities: string[];
    policyVersion: string;
  },
) {
  assertRole(actor.role,'admin');
  const db = getAppStateDb();
  const owned = await db.query.dataConnectors.findFirst({where:eq(schema.dataConnectors.id,input.connector.id)});
  if (owned && owned.organizationId !== actor.organizationId) throw new SecurityError(404,'connector_not_found','Connector not found in the active organization.');
  const catalog = semanticCatalogSchema.parse(input.catalog);
  if (catalog.entities.some(entity=>!entity.schemaVerified)) throw new SecurityError(400,'schema_not_verified','Onboarding requires a verified schema probe.');
  const selected = new Set(input.selectedEntities);
  const entities = catalog.entities.filter((entity) => selected.has(entity.entity));
  if (!entities.length || entities.length !== selected.size) {
    throw new Error("Connector activation contains an unknown or empty dataset selection.");
  }
  if (input.connector.status !== "healthy" || input.connector.engine !== "PostgreSQL") {
    throw new Error("Only a verified PostgreSQL connector can be activated.");
  }

  const connectorWrite = db
    .insert(schema.dataConnectors)
    .values({
      id: input.connector.id,
      organizationId: actor.organizationId,
      createdByUserId: actor.id,
      name: input.connector.name,
      engine: input.connector.engine,
      privateHost: input.connector.host,
      databaseName: input.connector.databaseName,
      region: input.connector.region,
      status: "healthy",
      lastCheckedAt: input.connector.lastCheckedAt,
    })
    .onConflictDoUpdate({
      target: schema.dataConnectors.id,
      setWhere:eq(schema.dataConnectors.organizationId,actor.organizationId),
      set: {
        name: input.connector.name,
        privateHost: input.connector.host,
        databaseName: input.connector.databaseName,
        region: input.connector.region,
        status: "healthy",
        lastCheckedAt: input.connector.lastCheckedAt,
        updatedAt: new Date().toISOString(),
      },
    });

  // New IDs are inserted without upsert: concurrent cross-tenant creation must fail
  // the complete batch, never proceed to child-record replacement.
  const initialWrite = owned ? connectorWrite : db.insert(schema.dataConnectors).values({id:input.connector.id,organizationId:actor.organizationId,createdByUserId:actor.id,name:input.connector.name,engine:input.connector.engine,privateHost:input.connector.host,databaseName:input.connector.databaseName,region:input.connector.region,status:'healthy',lastCheckedAt:input.connector.lastCheckedAt});
  const writes: BatchItem<'sqlite'>[] = [initialWrite,
  db.delete(schema.connectorPermissions).where(eq(schema.connectorPermissions.connectorId, input.connector.id)),
  db.insert(schema.connectorPermissions).values(
    entities.map((entity) => ({
      id: crypto.randomUUID(),
      connectorId: input.connector.id,
      tableName: entity.entity,
      allowedFieldsJson: JSON.stringify(entity.fields.map((field) => field.name)),
      maskedFieldsJson: JSON.stringify(entity.fields.filter((field) => field.masked).map((field) => field.name)),
      enabled: true,
    })),
  ),db.delete(schema.catalogSnapshots).where(eq(schema.catalogSnapshots.connectorId,input.connector.id))];
  const snapshotId = crypto.randomUUID();
  writes.push(db.insert(schema.catalogSnapshots).values({
    id: snapshotId,
    connectorId: input.connector.id,
    catalogVersion: catalog.catalogVersion,
    policyVersion: input.policyVersion,
    status: "active",
    entityCount: entities.length,
    fieldCount: entities.reduce((count, entity) => count + entity.fields.length, 0),
    validationJson: JSON.stringify({
      schemaVerified: entities.every((entity) => entity.schemaVerified),
      accessMode: "read_only",
      rawSqlAccepted: false,
    }),
    syncedAt: new Date().toISOString(),
  }));

  for (const entity of entities) {
    const catalogEntityId = crypto.randomUUID();
    writes.push(db.insert(schema.catalogEntities).values({
      id: catalogEntityId,
      snapshotId,
      entityName: entity.entity,
      label: entity.label,
      description: entity.description,
      sourceName: entity.source,
      primaryKey: entity.primaryKey,
      dateField: entity.dateField,
      amountField: entity.amountField,
      statusField: entity.statusField,
      maximumRows: entity.maximumRows,
      synonymsJson: JSON.stringify(entity.synonyms),
      defaultFieldsJson: JSON.stringify(entity.defaultFields),
    }));
    writes.push(db.insert(schema.catalogFields).values(
      entity.fields.map((field) => ({
        id: crypto.randomUUID(),
        catalogEntityId,
        fieldName: field.name,
        label: field.label,
        description: field.description,
        dataType: field.dataType,
        semanticType: field.semanticType,
        displayFormat: field.format,
        sensitivity: field.sensitivity,
        masked: field.masked,
        groupable: field.groupable,
        sortable: field.sortable,
        synonymsJson: JSON.stringify(field.synonyms),
        filterOperatorsJson: JSON.stringify(field.filterOperators),
        aggregationsJson: JSON.stringify(field.aggregations),
      })),
    ));
    if (entity.metrics.length) writes.push(db.insert(schema.catalogMetrics).values(
      entity.metrics.map((metric) => ({
        id: crypto.randomUUID(),
        catalogEntityId,
        metricName: metric.id,
        label: metric.label,
        description: metric.description,
        operation: metric.operation,
        fieldName: metric.field,
        displayFormat: metric.format,
      })),
    ));
  }
  const selectedRelationships = catalog.relationships.filter(
    (relationship) => selected.has(relationship.fromEntity) && selected.has(relationship.toEntity),
  );
  if (selectedRelationships.length) {
    writes.push(db.insert(schema.catalogRelationships).values(
      selectedRelationships.map((relationship) => ({
        id: crypto.randomUUID(),
        snapshotId,
        relationshipName: relationship.id,
        fromEntity: relationship.fromEntity,
        fromField: relationship.fromField,
        toEntity: relationship.toEntity,
        toField: relationship.toField,
        relationshipKind: relationship.kind,
        label: relationship.label,
      })),
    ));
  }
  await db.batch(writes as [typeof writes[number], ...typeof writes]);

  await recordAudit(actor, {
    action: "Semantic connector activated",
    target: input.connector.name,
    outcome: "success",
    requestId: `req_${crypto.randomUUID()}`,
    details: {
      catalogVersion: catalog.catalogVersion,
      policyVersion: input.policyVersion,
      datasets: entities.map((entity) => entity.entity),
      fieldCount: entities.reduce((count, entity) => count + entity.fields.length, 0),
    },
  });
}

export async function savePreferences(
  actor: AppActor,
  input: { emailSafetyAlerts: boolean; defaultSection?: string },
) {
  const db = getAppStateDb();
  await db
    .insert(schema.userPreferences)
    .values({
      userId: actor.id,
      emailSafetyAlerts: input.emailSafetyAlerts,
      defaultSection: input.defaultSection ?? "workspaces",
    })
    .onConflictDoUpdate({
      target: schema.userPreferences.userId,
      set: {
        emailSafetyAlerts: input.emailSafetyAlerts,
        defaultSection: input.defaultSection ?? "workspaces",
        updatedAt: new Date().toISOString(),
      },
    });
}

export async function recordWorkspaceRun(
  actor: AppActor,
  input: {
    prompt: string;
    response: DynamicWorkspaceResponse | null;
    status: "succeeded" | "failed" | "denied";
    durationMs?: number;
    errorCode?: string;
  },
) {
  const db = getAppStateDb();
  await db.insert(schema.workspaceRuns).values({
    id: crypto.randomUUID(),
    organizationId: actor.organizationId,
    userId: actor.id,
    prompt: input.prompt,
    intent: input.response?.intent ?? null,
    queryPlanJson: input.response
      ? JSON.stringify(input.response.queryPlan)
      : null,
    resultMetadataJson: input.response
      ? JSON.stringify(input.response.safety)
      : null,
    catalogVersion: input.response?.gateway?.catalogVersion ?? null,
    policyVersion: input.response?.gateway?.policyVersion ?? null,
    decisionId: input.response?.gateway?.decisionId ?? null,
    resultCount: input.response?.safety.returnedRows ?? null,
    status: input.status,
    durationMs: input.durationMs,
    errorCode: input.errorCode,
  });
  await recordAudit(actor, {
    action:
      input.status === "succeeded"
        ? "Workspace generated"
        : input.status === "denied"
          ? "Workspace request denied"
          : "Workspace generation failed",
    target: input.response?.spec.title ?? input.prompt.slice(0, 120),
    outcome:
      input.status === "succeeded"
        ? "success"
        : input.status === "denied"
          ? "denied"
          : "failure",
    requestId: `req_${crypto.randomUUID()}`,
    details: {
      intent: input.response?.intent,
      errorCode: input.errorCode,
      catalogVersion: input.response?.gateway?.catalogVersion,
      policyVersion: input.response?.gateway?.policyVersion,
      decisionId: input.response?.gateway?.decisionId,
      resultCount: input.response?.safety.returnedRows,
      durationMs: input.durationMs,
    },
  });
}

export async function recordAudit(
  actor: AppActor,
  event: Omit<AuditEventRecord, "id" | "createdAt" | "actor">,
) {
  const db = getAppStateDb();
  await db.insert(schema.auditEvents).values({
    id: crypto.randomUUID(),
    organizationId: actor.organizationId,
    actorUserId: actor.id,
    actorLabel: actor.fullName,
    action: event.action,
    target: event.target,
    outcome: event.outcome,
    requestId: event.requestId,
    detailsJson: JSON.stringify(event.details),
  });
}

function mapSavedWorkspace(
  row: typeof schema.savedWorkspaces.$inferSelect,
): SavedWorkspaceRecord {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    savedAt: row.createdAt,
    data: null,
    pinned: row.pinned,
    shared:row.shared,
  };
}

function mapAccessRule(
  row: typeof schema.accessRules.$inferSelect,
): AccessRuleRecord {
  return {
    id: row.id,
    name: row.name,
    scope: row.datasetScope,
    fields: `${row.permittedFieldCount} fields`,
    mode: "Read only",
    users: row.teamName,
    enabled: row.enabled,
  };
}

function mapConnector(
  row: typeof schema.dataConnectors.$inferSelect,
): ConnectorRecord {
  return {
    id: row.id,
    name: row.name,
    engine: row.engine,
    host: row.privateHost,
    databaseName: row.databaseName,
    region: row.region,
    status: row.status,
    lastCheckedAt: row.lastCheckedAt,
  };
}

function mapAuditEvent(
  row: typeof schema.auditEvents.$inferSelect,
): AuditEventRecord {
  return {
    id: row.id,
    action: row.action,
    actor: row.actorLabel,
    target: row.target,
    outcome: row.outcome,
    requestId: row.requestId,
    details: parseJson<Record<string, unknown>>(row.detailsJson, {}),
    createdAt: row.createdAt,
  };
}

async function seedOrganization(
  db: ReturnType<typeof getAppStateDb>,
  userId: string,
) {
  const existingConnector = await db.query.dataConnectors.findFirst({
    where: eq(schema.dataConnectors.id, DEFAULT_CONNECTOR_ID),
  });

  if (!existingConnector) {
    await db.insert(schema.dataConnectors).values({
      id: DEFAULT_CONNECTOR_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      createdByUserId: userId,
      name: "Production PostgreSQL",
      engine: "PostgreSQL",
      privateHost: "customer-network",
      databaseName: "insurance_operations",
      region: "Mumbai",
      status: "healthy",
      lastCheckedAt: new Date().toISOString(),
    });

    await db.insert(schema.connectorPermissions).values(
      ["policies", "claims", "renewals"].map((tableName) => ({
        id: `permission_${tableName}`,
        connectorId: DEFAULT_CONNECTOR_ID,
        tableName,
        allowedFieldsJson: "[]",
        maskedFieldsJson: "[]",
        enabled: true,
      })),
    );
  }

  const existingRule = await db.query.accessRules.findFirst({
    where: eq(schema.accessRules.organizationId, DEFAULT_ORGANIZATION_ID),
  });
  if (!existingRule) {
    const seedRules = [
      ["policy-operations", "Policy operations", "policies", 11, "Operations team"],
      ["claims-overview", "Claims overview", "claims", 9, "Claims managers"],
      ["customer-service", "Customer service", "endorsements", 9, "Support leads"],
    ] as const;
    await db.insert(schema.accessRules).values(
      seedRules.map(([id, name, scope, count, team]) => ({
        id,
        organizationId: DEFAULT_ORGANIZATION_ID,
        name,
        datasetScope: scope,
        permittedFieldCount: count,
        accessMode: "read_only",
        teamName: team,
        enabled: true,
        createdByUserId: userId,
      })),
    );
  } else {
    const legacyScopes = {
      "policy-operations": ["motor_policies", "policies", 11],
      "claims-overview": ["claims_summary", "claims", 9],
      "customer-service": ["service_requests", "endorsements", 9],
    } as const;
    for (const [id, [legacy, scope, count]] of Object.entries(legacyScopes)) {
      const rule = await db.query.accessRules.findFirst({ where: eq(schema.accessRules.id, id) });
      if (rule?.datasetScope === legacy) {
        await db.update(schema.accessRules).set({ datasetScope: scope, permittedFieldCount: count }).where(eq(schema.accessRules.id, id));
      }
    }
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export async function updateWorkspace(actor:AppActor,id:string,changes:{title?:string;pinned?:boolean;shared?:boolean;delete?:boolean}) {
  assertRole(actor.role,'member');
  const db = getAppStateDb();
  const owned = and(eq(schema.savedWorkspaces.id,id),eq(schema.savedWorkspaces.organizationId,actor.organizationId),eq(schema.savedWorkspaces.ownerUserId,actor.id));
  const existing = await db.query.savedWorkspaces.findFirst({where:owned});
  if (!existing) throw new SecurityError(404,'workspace_not_found','Workspace not found or not owned by you.');
  if (changes.delete) await db.delete(schema.savedWorkspaces).where(owned);
  else await db.update(schema.savedWorkspaces).set({title:changes.title??existing.title,pinned:changes.pinned??existing.pinned,shared:changes.shared??existing.shared,updatedAt:new Date().toISOString()}).where(owned);
  await recordAudit(actor,{action:changes.delete?'Workspace deleted':'Workspace updated',target:id,outcome:'success',requestId:crypto.randomUUID(),details:{shared:changes.shared,pinned:changes.pinned}});
}

export async function activeConnectorFor(actor:AppActor) {
  const db=getAppStateDb();
  const connector = await db.query.dataConnectors.findFirst({where:and(eq(schema.dataConnectors.organizationId,actor.organizationId),eq(schema.dataConnectors.status,'healthy')),orderBy:[desc(schema.dataConnectors.updatedAt)]});
  if (!connector) throw new SecurityError(409,'connector_required','An administrator must activate a connector first.');
  const permissions = await db.query.connectorPermissions.findMany({where:and(eq(schema.connectorPermissions.connectorId,connector.id),eq(schema.connectorPermissions.enabled,true))});
  return {connector,entities:permissions.map(p=>p.tableName)};
}
