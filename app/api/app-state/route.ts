import { ZodError, z } from "zod";
import {
  addConnector,
  activateConnector,
  ensureAppActor,
  loadAppState,
  recordAudit,
  recordWorkspaceRun,
  replaceRules,
  savePreferences,
  saveWorkspace,
  setConnectorPermissions,
} from "@/db/app-state";
import { semanticCatalogSchema } from "@/lib/catalog/semantic";

export const dynamic = "force-dynamic";

const savedWorkspaceSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  prompt: z.string().trim().min(8).max(500),
  savedAt: z.string(),
  data: z.unknown().nullable(),
  pinned: z.boolean().default(false),
});

const accessRuleSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(2).max(100),
  scope: z.string().regex(/^[a-z0-9_]+$/).max(100),
  fields: z.string().regex(/^\d{1,2} fields$/),
  mode: z.literal("Read only"),
  users: z.string().trim().min(2).max(100),
  enabled: z.boolean(),
});

const connectorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(100),
  engine: z.enum(["PostgreSQL", "MySQL", "SQL Server"]),
  host: z.string().trim().min(3).max(255),
  databaseName: z.string().trim().min(1).max(100),
  region: z.string().trim().min(2).max(80),
  status: z.enum(["draft", "healthy", "unavailable"]),
  lastCheckedAt: z.string().nullable(),
});

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save_workspace"), workspace: savedWorkspaceSchema }),
  z.object({ action: z.literal("replace_rules"), rules: z.array(accessRuleSchema).max(100) }),
  z.object({ action: z.literal("add_connector"), connector: connectorSchema }),
  z.object({
    action: z.literal("activate_connector"),
    connector: connectorSchema,
    catalog: semanticCatalogSchema,
    selectedEntities: z.array(z.enum(["policies", "claims", "endorsements"])).min(1).max(3),
    policyVersion: z.string().min(1).max(100),
  }),
  z.object({
    action: z.literal("set_connector_permissions"),
    connectorId: z.string().min(1).max(100),
    tables: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(100),
  }),
  z.object({
    action: z.literal("save_preferences"),
    emailSafetyAlerts: z.boolean(),
    defaultSection: z.string().max(40).optional(),
  }),
  z.object({
    action: z.literal("record_workspace_run"),
    prompt: z.string().trim().min(8).max(500),
    response: z.unknown().nullable(),
    status: z.enum(["succeeded", "failed", "denied"]),
    durationMs: z.number().int().min(0).max(120_000).optional(),
    errorCode: z.string().max(100).optional(),
  }),
  z.object({
    action: z.literal("record_audit"),
    event: z.object({
      action: z.string().trim().min(2).max(120),
      target: z.string().trim().min(1).max(300),
      outcome: z.enum(["success", "denied", "failure"]),
      requestId: z.string().trim().min(4).max(120),
      details: z.record(z.string(), z.unknown()),
    }),
  }),
]);

export async function GET(request: Request) {
  try {
    const actor = await ensureAppActor(request);
    return Response.json(await loadAppState(actor), {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    console.error("App state bootstrap failed", error);
    return Response.json(
      { error: "Persistent application state is temporarily unavailable." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const actor = await ensureAppActor(request);
    const input = actionSchema.parse(await request.json());

    if (input.action === "save_workspace") {
      await saveWorkspace(actor, input.workspace as Parameters<typeof saveWorkspace>[1]);
    } else if (input.action === "replace_rules") {
      await replaceRules(actor, input.rules);
    } else if (input.action === "add_connector") {
      await addConnector(actor, input.connector);
    } else if (input.action === "activate_connector") {
      await activateConnector(actor, input);
    } else if (input.action === "set_connector_permissions") {
      await setConnectorPermissions(actor, input.connectorId, input.tables);
    } else if (input.action === "save_preferences") {
      await savePreferences(actor, input);
    } else if (input.action === "record_workspace_run") {
      await recordWorkspaceRun(actor, input as Parameters<typeof recordWorkspaceRun>[1]);
    } else if (input.action === "record_audit") {
      await recordAudit(actor, input.event);
    }

    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return Response.json(
        { error: "The persistence request is invalid." },
        { status: 400 },
      );
    }
    console.error("App state mutation failed", error);
    return Response.json(
      { error: "The change could not be saved. No partial confirmation was returned." },
      { status: 503 },
    );
  }
}
