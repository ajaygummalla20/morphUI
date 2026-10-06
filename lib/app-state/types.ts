import type { DynamicWorkspaceResponse } from "@/lib/workspaces/dynamic";
import type { SemanticCatalog } from "@/lib/catalog/semantic";

export type SavedWorkspaceRecord = {
  id: string;
  title: string;
  prompt: string;
  savedAt: string;
  data: DynamicWorkspaceResponse | null;
  pinned: boolean;
  shared?:boolean;
  canEdit?:boolean;
};

export type AccessRuleRecord = {
  id: string;
  name: string;
  scope: string;
  fields: string;
  mode: "Read only";
  users: string;
  enabled: boolean;
};

export type ConnectorRecord = {
  id: string;
  name: string;
  engine: string;
  host: string;
  databaseName: string;
  region: string;
  status: "draft" | "healthy" | "unavailable";
  lastCheckedAt: string | null;
};

export type AuditEventRecord = {
  id: string;
  action: string;
  actor: string;
  target: string;
  outcome: "success" | "denied" | "failure";
  requestId: string;
  details: Record<string, unknown>;
  createdAt: string;
};

export type AppStateBootstrap = {
  mode: "cloud";
  organization: {
    id: string;
    name: string;
    slug: string;
    dataRegion: string;
  };
  user: {
    id: string;
    email: string;
    fullName: string;
    role: "admin" | "member" | "viewer";
  };
  savedWorkspaces: SavedWorkspaceRecord[];
  accessRules: AccessRuleRecord[];
  connectors: ConnectorRecord[];
  approvedTables: string[];
  preferences: {
    emailSafetyAlerts: boolean;
    defaultSection: string;
  };
  auditEvents: AuditEventRecord[];
};

export type AppStateAction =
  | {action:'update_workspace'; id:string; title?:string;pinned?:boolean;shared?:boolean;delete?:boolean}
  | {
      action: "save_workspace";
      workspace: SavedWorkspaceRecord;
    }
  | {
      action: "replace_rules";
      rules: AccessRuleRecord[];
    }
  | {
      action: "add_connector";
      connector: ConnectorRecord;
    }
  | {
      action: "set_connector_permissions";
      connectorId: string;
      tables: string[];
    }
  | {
      action: "activate_connector";
      connector: ConnectorRecord;
      catalog: SemanticCatalog;
      selectedEntities: string[];
      policyVersion: string;
    }
  | {
      action: "save_preferences";
      emailSafetyAlerts: boolean;
      defaultSection?: string;
    }
  | {
      action: "record_workspace_run";
      prompt: string;
      response: DynamicWorkspaceResponse | null;
      status: "succeeded" | "failed" | "denied";
      durationMs?: number;
      errorCode?: string;
    }
  | {
      action: "record_audit";
      event: Omit<AuditEventRecord, "id" | "createdAt" | "actor">;
    };
