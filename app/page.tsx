"use client";

import { animate, stagger } from "animejs";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "motion/react";
import {
  Activity,
  ArrowRight,
  Bell,
  Blocks,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleGauge,
  Clock3,
  Code2,
  Copy,
  Database,
  Download,
  FileClock,
  Filter,
  Fingerprint,
  KeyRound,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Menu,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UsersRound,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  DynamicWorkspaceResponse,
  TableCellFormat,
  WorkspaceSpec,
} from "@/lib/workspaces/dynamic";
import type {
  AccessRuleRecord,
  AppStateAction,
  AppStateBootstrap,
  AuditEventRecord,
  ConnectorRecord,
  SavedWorkspaceRecord,
} from "@/lib/app-state/types";
import type { GatewayCatalogResponse } from "@/lib/gateway/contract";
import type { SemanticCatalog } from "@/lib/catalog/semantic";
import { escapeCsv } from "@/lib/workspaces/export";

type SectionId = "workspaces" | "sources" | "rules" | "audit";
type GenerationPhase = "ready" | "understanding" | "checking" | "building";
type AppOverlay = "search" | "notifications" | "profile" | "organization" | null;
type PersistenceMode = "connecting" | "cloud" | "device";
type SavedWorkspace = SavedWorkspaceRecord;
type AccessRule = AccessRuleRecord;
type GatewayCatalogPayload = GatewayCatalogResponse & {
  sourceMode: "client_gateway" | "secure_demo";
};

type WorkspaceBlock = WorkspaceSpec["blocks"][number];
type TableBlock = Extract<WorkspaceBlock, { type: "table" }>;

const navItems = [
  { id: "workspaces" as const, label: "Workspaces", icon: Blocks },
  { id: "sources" as const, label: "Data sources", icon: Database },
  { id: "rules" as const, label: "Access rules", icon: ShieldCheck },
  { id: "audit" as const, label: "Audit log", icon: FileClock },
];

const SAVED_WORKSPACES_KEY = "morphui.saved-workspaces.v1";
const ACCESS_RULES_KEY = "morphui.access-rules.v1";
const DRAFT_SOURCES_KEY = "morphui.draft-sources.v1";
const APPROVED_TABLES_KEY = "morphui.approved-tables.v1";
const EMAIL_ALERTS_KEY = "morphui.email-alerts.v1";

const defaultConnector: ConnectorRecord = {
  id: "connector_production_postgresql",
  name: "Production PostgreSQL",
  engine: "PostgreSQL",
  host: "customer-network",
  databaseName: "insurance_operations",
  region: "Mumbai",
  status: "healthy",
  lastCheckedAt: null,
};

const defaultAccessRules: AccessRule[] = [
  {
    id: "policy-operations",
    name: "Policy operations",
    scope: "motor_policies",
    fields: "8 fields",
    mode: "Read only",
    users: "Operations team",
    enabled: true,
  },
  {
    id: "claims-overview",
    name: "Claims overview",
    scope: "claims_summary",
    fields: "6 fields",
    mode: "Read only",
    users: "Claims managers",
    enabled: true,
  },
  {
    id: "customer-service",
    name: "Customer service",
    scope: "service_requests",
    fields: "11 fields",
    mode: "Read only",
    users: "Support leads",
    enabled: true,
  },
];

const initialWorkspaceSpec: WorkspaceSpec = {
  title: "Motor renewals — next 15 days",
  description: "Policies above ₹20K, grouped by relationship manager",
  source: "Production PostgreSQL",
  generatedIn: "2.4s",
  blocks: [
    {
      type: "metrics",
      items: [
        {
          label: "Renewals due",
          value: "24",
          delta: "+6 this week",
          tone: "lime",
        },
        {
          label: "Premium at risk",
          value: "₹7.84L",
          delta: "Across 18 accounts",
          tone: "orange",
        },
        {
          label: "High priority",
          value: "6",
          delta: "Needs action today",
          tone: "blue",
        },
      ],
    },
    {
      type: "trend",
      title: "Renewal value by day",
      subtitle: "Aug 09 — Aug 24",
      values: [18, 28, 23, 42, 34, 52, 47, 68, 61, 83, 72, 91],
      total: "₹7.84L",
      labels: ["Aug 09", "Aug 16", "Aug 24"],
      axisLabels: ["High", "Mid", "Low"],
    },
    {
      type: "table",
      title: "Policies requiring attention",
      emptyMessage:
        "No renewals match this request. Try a longer date range or lower premium.",
      columns: [
        { key: "policy", label: "Policy", format: "id" },
        { key: "customer", label: "Customer" },
        { key: "expiry", label: "Expiry", format: "date" },
        { key: "premium", label: "Premium", format: "currency" },
        { key: "manager", label: "RM", format: "person" },
        { key: "priority", label: "Priority", format: "badge" },
      ],
      totalRows: 24,
      rows: [
        {
          policy: "MTR-48291",
          customer: "Aarav Logistics",
          expiry: "12 Aug 2026",
          premium: 86400,
          manager: "Neha Rao",
          priority: "High",
        },
        {
          policy: "MTR-39104",
          customer: "Meridian Foods",
          expiry: "14 Aug 2026",
          premium: 62900,
          manager: "Arjun Mehta",
          priority: "High",
        },
        {
          policy: "MTR-51028",
          customer: "Northstar Retail",
          expiry: "17 Aug 2026",
          premium: 41250,
          manager: "Neha Rao",
          priority: "Medium",
        },
        {
          policy: "MTR-28472",
          customer: "Vega Components",
          expiry: "21 Aug 2026",
          premium: 28800,
          manager: "Kabir Shah",
          priority: "Standard",
        },
      ],
    },
  ],
};

const initialQueryPlan = `{
  "source": "policies_read_replica",
  "operation": "select",
  "entity": "motor_policies",
  "fields": [
    "policy_no", "customer_name", "expiry_date",
    "premium", "relationship_manager", "priority"
  ],
  "filters": [
    { "field": "expiry_date", "op": "within_days", "value": 15 },
    { "field": "premium", "op": "greater_than", "value": 20000 }
  ],
  "row_limit": 200
}`;

const auditEvents = [
  {
    action: "Workspace generated",
    actor: "You",
    target: "Motor renewals — next 15 days",
    time: "Just now",
    icon: WandSparkles,
  },
  {
    action: "Policy check passed",
    actor: "Morph Gateway",
    target: "6 allowed fields · read-only",
    time: "Just now",
    icon: ShieldCheck,
  },
  {
    action: "Schema permission updated",
    actor: "Priya S.",
    target: "motor_policies.priority enabled",
    time: "Yesterday, 4:18 PM",
    icon: KeyRound,
  },
  {
    action: "Data source health check",
    actor: "Morph Gateway",
    target: "Production PostgreSQL",
    time: "Yesterday, 2:06 PM",
    icon: Database,
  },
];

const spring = { type: "spring" as const, stiffness: 360, damping: 32 };

export default function Home() {
  const [section, setSection] = useState<SectionId>("workspaces");
  const [phase, setPhase] = useState<GenerationPhase>("ready");
  const [prompt, setPrompt] = useState(
    "Show motor policies expiring in the next 15 days with premium above ₹20,000, grouped by relationship manager.",
  );
  const [saved, setSaved] = useState(false);
  const [inspector, setInspector] = useState<"safety" | "query">("safety");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<AppOverlay>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(2);
  const [savedWorkspaces, setSavedWorkspaces] = useState<SavedWorkspace[]>(() =>
    readLocalArray<SavedWorkspace>(SAVED_WORKSPACES_KEY),
  );
  const [accessRules, setAccessRules] = useState<AccessRule[]>(() => {
    const stored = readLocalArray<AccessRule>(ACCESS_RULES_KEY);
    return stored.length ? stored : defaultAccessRules;
  });
  const [connectors, setConnectors] = useState<ConnectorRecord[]>(() => [
    defaultConnector,
    ...readLocalArray<Partial<ConnectorRecord>>(DRAFT_SOURCES_KEY).map(
      normalizeLocalConnector,
    ),
  ]);
  const [approvedTables, setApprovedTables] = useState<string[]>(() => {
    const stored = readLocalArray<string>(APPROVED_TABLES_KEY);
    return stored.length ? stored : ["policies", "claims", "renewals"];
  });
  const [auditRecords, setAuditRecords] = useState<AuditEventRecord[]>([]);
  const [emailAlerts, setEmailAlerts] = useState(() =>
    readLocalBoolean(EMAIL_ALERTS_KEY, true),
  );
  const [activeUser, setActiveUser] = useState<AppStateBootstrap["user"]>({
    id: "local-user",
    email: "kiran@atlas.example",
    fullName: "Kiran S.",
    role: "admin",
  });
  const [persistenceMode, setPersistenceMode] =
    useState<PersistenceMode>("connecting");
  const [workspaceData, setWorkspaceData] =
    useState<DynamicWorkspaceResponse | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const assemblyRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const workspaceSpec = workspaceData?.spec ?? initialWorkspaceSpec;
  const queryPlan = workspaceData
    ? JSON.stringify(workspaceData.queryPlan, null, 2)
    : initialQueryPlan;

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOverlay("search");
      } else if (event.key === "/" && !isTyping) {
        event.preventDefault();
        setOverlay("search");
      } else if (event.key === "Escape") {
        setOverlay(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;

    requestAppStateBootstrap()
      .then((state) => {
        if (cancelled) return;
        setSavedWorkspaces(state.savedWorkspaces);
        setAccessRules(state.accessRules);
        setConnectors(state.connectors);
        setApprovedTables(state.approvedTables);
        setAuditRecords(state.auditEvents);
        setEmailAlerts(state.preferences.emailSafetyAlerts);
        setActiveUser(state.user);
        setPersistenceMode("cloud");
      })
      .catch(() => {
        if (!cancelled) setPersistenceMode("device");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    requestDynamicWorkspace(
      "Show motor policies expiring in the next 15 days with premium above ₹20,000, grouped by relationship manager.",
    )
      .then((response) => {
        if (!cancelled) {
          setWorkspaceData(response);
          setWorkspaceError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWorkspaceError(
            "The data API could not be reached. The last safe workspace is still shown.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== "building" || !assemblyRef.current || reduceMotion) return;
    const animation = animate(
      assemblyRef.current.querySelectorAll(".assembly-block"),
      {
        opacity: [0, 1],
        translateY: [16, 0],
        scale: [0.97, 1],
        delay: stagger(95),
        duration: 560,
        ease: "out(3)",
      },
    );
    return () => {
      animation.cancel();
    };
  }, [phase, reduceMotion]);

  const persistAction = async (
    action: AppStateAction,
    writeDeviceFallback: () => void,
  ) => {
    try {
      await requestAppStateMutation(action);
      setPersistenceMode("cloud");
      return true;
    } catch {
      writeDeviceFallback();
      setPersistenceMode("device");
      return false;
    }
  };

  const generateWorkspace = async () => {
    if (phase !== "ready") return;
    const startedAt = performance.now();
    setSaved(false);
    setWorkspaceError(null);
    setWorkspaceLoading(true);
    setPhase("understanding");
    const request = requestDynamicWorkspace(prompt);

    try {
      await wait(reduceMotion ? 80 : 680);
      setPhase("checking");
      await wait(reduceMotion ? 80 : 720);
      const response = await request;
      setPhase("building");
      setWorkspaceData(response);
      await wait(reduceMotion ? 100 : 800);
      setPhase("ready");
      void persistAction(
        {
          action: "record_workspace_run",
          prompt,
          response,
          status: "succeeded",
          durationMs: Math.round(performance.now() - startedAt),
        },
        () => undefined,
      );
      setToast(
        response.sourceMode === "client_gateway"
          ? "Workspace rebuilt through the client Gateway"
          : "Workspace rebuilt through the secure demo Gateway",
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "We could not build this workspace. Your previous view was preserved.";
      setPhase("ready");
      setWorkspaceError(message);
      void persistAction(
        {
          action: "record_workspace_run",
          prompt,
          response: null,
          status: /not supported|denied|allowed/i.test(message) ? "denied" : "failed",
          durationMs: Math.round(performance.now() - startedAt),
          errorCode: "workspace_generation_error",
        },
        () => undefined,
      );
      setToast("Workspace not changed — check the guided request");
    } finally {
      setWorkspaceLoading(false);
    }
  };

  const chooseSection = (id: SectionId) => {
    setSection(id);
    setSidebarOpen(false);
    setOverlay(null);
  };

  const saveCurrentWorkspace = async () => {
    const existing = savedWorkspaces.find((item) => item.prompt === prompt);
    if (existing) {
      setSaved(true);
      setToast("This workspace is already saved");
      return;
    }

    const item: SavedWorkspace = {
      id: crypto.randomUUID(),
      title: workspaceSpec.title,
      prompt,
      savedAt: new Date().toISOString(),
      data: workspaceData,
      pinned: false,
    };
    const next = [item, ...savedWorkspaces].slice(0, 12);
    setSavedWorkspaces(next);
    setSaved(true);
    const cloudSaved = await persistAction(
      { action: "save_workspace", workspace: item },
      () => writeLocalArray(SAVED_WORKSPACES_KEY, next),
    );
    setToast(
      cloudSaved
        ? "Workspace saved to Morph cloud"
        : "Cloud unavailable · workspace saved on this device",
    );
  };

  const updateAccessRules = (next: AccessRule[]) => {
    setAccessRules(next);
    void persistAction(
      { action: "replace_rules", rules: next },
      () => writeLocalArray(ACCESS_RULES_KEY, next),
    );
  };

  const saveApprovedTables = async (
    tables: string[],
    connectorId?: string,
  ) => {
    setApprovedTables(tables);
    const primaryConnector =
      selectPrimaryConnector(connectors) ??
      defaultConnector;
    const cloudSaved = await persistAction(
      {
        action: "set_connector_permissions",
        connectorId: connectorId ?? primaryConnector.id,
        tables,
      },
      () => writeLocalArray(APPROVED_TABLES_KEY, tables),
    );
    setToast(
      cloudSaved
        ? `Table access request saved · client Gateway approval required`
        : `Table access request saved on this device · Gateway approval required`,
    );
  };

  const activateSemanticConnector = async (
    connector: ConnectorRecord,
    catalog: SemanticCatalog,
    selectedEntities: string[],
    policyVersion: string,
  ) => {
    const next = [...connectors.filter((item) => item.id !== connector.id), connector];
    setConnectors(next);
    setApprovedTables(selectedEntities);
    const cloudSaved = await persistAction(
      {
        action: "activate_connector",
        connector,
        catalog,
        selectedEntities,
        policyVersion,
      },
      () => {
        writeLocalArray(DRAFT_SOURCES_KEY, next.filter((item) => item.id !== defaultConnector.id));
        writeLocalArray(APPROVED_TABLES_KEY, selectedEntities);
      },
    );
    setToast(
      cloudSaved
        ? `Semantic catalogue ${catalog.catalogVersion} activated`
        : "Cloud unavailable · connector definition saved on this device",
    );
  };

  const saveProfilePreferences = async (nextEmailAlerts: boolean) => {
    setEmailAlerts(nextEmailAlerts);
    const cloudSaved = await persistAction(
      {
        action: "save_preferences",
        emailSafetyAlerts: nextEmailAlerts,
        defaultSection: section,
      },
      () => writeLocalBoolean(EMAIL_ALERTS_KEY, nextEmailAlerts),
    );
    setToast(
      cloudSaved
        ? "Preferences saved to Morph cloud"
        : "Cloud unavailable · preferences saved on this device",
    );
  };

  const openSavedWorkspace = (item: SavedWorkspace) => {
    setPrompt(item.prompt);
    if (item.data) setWorkspaceData(item.data);
    setSaved(true);
    chooseSection("workspaces");
    setToast(item.data ? `Restored ${item.title}` : "Saved prompt loaded");
  };

  return (
    <main className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <AnimatePresence>
        {sidebarOpen && (
          <motion.button
            className="mobile-scrim"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>

      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <button
            className="brand"
            aria-label="Go to workspaces"
            onClick={() => chooseSection("workspaces")}
          >
            <MorphMark />
            <span>Morph</span>
          </button>
          <button
            className="icon-button sidebar-close"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose size={17} />
          </button>
        </div>

        <button
          className="org-switcher"
          onClick={() => setOverlay("organization")}
          aria-label="Switch workspace"
        >
          <div className="org-avatar">AI</div>
          <div>
            <span className="eyebrow">Workspace</span>
            <strong>Atlas Insurance</strong>
          </div>
          <ChevronDown size={15} />
        </button>

        <nav className="primary-nav" aria-label="Primary navigation">
          <p className="nav-label">Build</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${section === item.id ? "active" : ""}`}
                onClick={() => chooseSection(item.id)}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.id === "sources" && <i className="status-dot" />}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-source">
          <div className="source-heading">
            <span className="source-icon">
              <Database size={15} />
            </span>
            <div>
              <strong>PostgreSQL</strong>
              <span>Production replica</span>
            </div>
            <CheckCircle2 size={16} />
          </div>
          <div className="source-meta">
            <span><i /> Healthy</span>
            <span>Read only</span>
          </div>
        </div>

        <button className="profile-row" onClick={() => setOverlay("profile")}>
          <div className="profile-avatar">{initials(activeUser.fullName)}</div>
          <div>
            <strong>{activeUser.fullName}</strong>
            <span>Workspace admin</span>
          </div>
          <MoreHorizontal size={17} />
        </button>
      </aside>

      <section className="main-frame">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button menu-button"
              aria-label="Open navigation"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu size={19} />
            </button>
            <div>
              <span className="eyebrow">Atlas Insurance / Operations</span>
              <h1>{navItems.find((item) => item.id === section)?.label}</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div className={`persistence-pill ${persistenceMode}`}>
              {persistenceMode === "cloud" ? (
                <><CheckCircle2 size={13} /> Cloud saved</>
              ) : persistenceMode === "device" ? (
                <><Database size={13} /> Device fallback</>
              ) : (
                <><LoaderCircle size={13} className="spin" /> Connecting</>
              )}
            </div>
            <div className="safe-pill"><LockKeyhole size={13} /> Safe mode</div>
            <button className="icon-button" aria-label="Search" onClick={() => setOverlay("search")}>
              <Search size={17} />
            </button>
            <button className="icon-button notification-button" aria-label="Notifications" onClick={() => setOverlay("notifications")}>
              <Bell size={17} />
              {unreadNotifications > 0 && <i />}
            </button>
            <button className="top-avatar" aria-label="Open profile" onClick={() => setOverlay("profile")}>{initials(activeUser.fullName)}</button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          <motion.div
            key={section}
            className="page-content"
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.24 }}
          >
            {section === "workspaces" && (
              <WorkspaceView
                prompt={prompt}
                setPrompt={(value) => {
                  setPrompt(value);
                  setSaved(false);
                }}
                phase={phase}
                generateWorkspace={generateWorkspace}
                assemblyRef={assemblyRef}
                inspector={inspector}
                setInspector={setInspector}
                saved={saved}
                onSave={saveCurrentWorkspace}
                setToast={setToast}
                reduceMotion={Boolean(reduceMotion)}
                workspaceSpec={workspaceSpec}
                workspaceData={workspaceData}
                queryPlan={queryPlan}
                workspaceError={workspaceError}
                workspaceLoading={workspaceLoading}
                onOpenSources={() => chooseSection("sources")}
              />
            )}
            {section === "sources" && (
              <SourcesView
                setToast={setToast}
                connectors={connectors}
                approvedTables={approvedTables}
                onSaveApprovedTables={saveApprovedTables}
                onActivateConnector={activateSemanticConnector}
                persistenceMode={persistenceMode}
              />
            )}
            {section === "rules" && (
              <RulesView
                setToast={setToast}
                rules={accessRules}
                setRules={updateAccessRules}
              />
            )}
            {section === "audit" && (
              <AuditView setToast={setToast} events={auditRecords} />
            )}
          </motion.div>
        </AnimatePresence>
      </section>

      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={spring}
          >
            <span><Check size={14} strokeWidth={2.5} /></span>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {overlay && (
          <GlobalOverlay
            overlay={overlay}
            onClose={() => setOverlay(null)}
            onNavigate={chooseSection}
            onSelectPrompt={(value) => {
              setPrompt(value);
              setSaved(false);
              chooseSection("workspaces");
            }}
            savedWorkspaces={savedWorkspaces}
            onOpenSaved={openSavedWorkspace}
            unreadNotifications={unreadNotifications}
            persistenceMode={persistenceMode}
            activeUser={activeUser}
            emailAlerts={emailAlerts}
            onSavePreferences={saveProfilePreferences}
            onMarkNotificationsRead={() => {
              setUnreadNotifications(0);
              setToast("Notifications marked as read");
            }}
            setToast={setToast}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function WorkspaceView({
  prompt,
  setPrompt,
  phase,
  generateWorkspace,
  assemblyRef,
  inspector,
  setInspector,
  saved,
  onSave,
  setToast,
  reduceMotion,
  workspaceSpec,
  workspaceData,
  queryPlan,
  workspaceError,
  workspaceLoading,
  onOpenSources,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  phase: GenerationPhase;
  generateWorkspace: () => void;
  assemblyRef: React.RefObject<HTMLDivElement | null>;
  inspector: "safety" | "query";
  setInspector: (value: "safety" | "query") => void;
  saved: boolean;
  onSave: () => void;
  setToast: (value: string) => void;
  reduceMotion: boolean;
  workspaceSpec: WorkspaceSpec;
  workspaceData: DynamicWorkspaceResponse | null;
  queryPlan: string;
  workspaceError: string | null;
  workspaceLoading: boolean;
  onOpenSources: () => void;
}) {
  const isGenerating = phase !== "ready";
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceMenuRef = useOutsideClick<HTMLDivElement>(
    workspaceMenuOpen,
    () => setWorkspaceMenuOpen(false),
  );

  return (
    <div className="workspace-page">
      <section className="workspace-intro">
        <div>
          <div className="intro-kicker"><Sparkles size={14} /> Dynamic workspace</div>
          <h2>What do you need to see?</h2>
          <p>Morph builds a secure interface around the job you describe.</p>
        </div>
        <button
          className={`secondary-button ${saved ? "saved" : ""}`}
          onClick={onSave}
        >
          {saved ? <Check size={15} /> : <Save size={15} />}
          {saved ? "Saved" : "Save workspace"}
        </button>
      </section>

      <section className="prompt-card">
        <div className="prompt-orb"><WandSparkles size={19} /></div>
        <div className="prompt-main">
          <label htmlFor="workspace-prompt">Describe your workspace</label>
          <textarea
            id="workspace-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={2}
          />
          <div className="prompt-footer">
            <div className="prompt-context">
              <button onClick={onOpenSources} title="Open data sources">
                <Database size={13} />
                {workspaceData?.spec.source ?? "policies_read_replica"}
                <ChevronDown size={12} />
              </button>
              <span><ShieldCheck size={13} /> {workspaceData?.safety.fieldsAccessed ?? 8} Gateway-approved fields</span>
            </div>
            <button
              className="generate-button"
              disabled={isGenerating || !prompt.trim()}
              onClick={generateWorkspace}
            >
              {isGenerating ? <LoaderCircle className="spin" size={16} /> : <Play size={15} fill="currentColor" />}
              {isGenerating ? "Building" : "Build workspace"}
            </button>
          </div>
        </div>
      </section>

      <div className="suggestion-row" aria-label="Prompt suggestions">
        <span>Try</span>
        <button onClick={() => setPrompt("Show motor policies expiring in the next 15 days above ₹20,000.")}>Upcoming renewals</button>
        <button onClick={() => setPrompt("Show high-value claims reported this month by branch.")}>High-value claims</button>
        <button onClick={() => setPrompt("Show pending endorsements grouped by type.")}>Pending endorsements</button>
        <button onClick={() => setPrompt("Show the active policy portfolio by product.")}>Policy portfolio</button>
      </div>

      {workspaceData && (
        <div className="interpretation-strip">
          <Sparkles size={13} />
          <span>Understood as</span>
          <strong>{workspaceData.interpretation}</strong>
        </div>
      )}

      {workspaceData?.planner?.mode === "deterministic_fallback" && (
        <p className="planner-notice" role="status">
          <strong>Basic planner used.</strong>{" "}
          {workspaceData.planner.reason === "ai_not_configured"
            ? "AI planning is not configured for this connection."
            : "AI planning was unavailable or its answer could not be validated."}{" "}
          Check the interpreted request and filters, or select Build workspace to try again.
        </p>
      )}

      {workspaceError && (
        <div className="workspace-alert" role="alert">
          <Database size={14} />
          <span>{workspaceError}</span>
          <button onClick={generateWorkspace}>Retry</button>
        </div>
      )}

      <div className="workspace-grid">
        <section className="result-panel">
          <div className="result-toolbar">
            <div className="result-title">
              <span className="live-dot" />
              <div>
                <strong>{workspaceSpec.title}</strong>
                <span>{workspaceSpec.description}</span>
              </div>
            </div>
            <div className="result-actions">
              <span className={`source-mode-tag ${workspaceData?.sourceMode ?? "loading"}`}>
                {workspaceLoading ? <LoaderCircle className="spin" size={11} /> : <Database size={11} />}
                {workspaceLoading
                  ? "Connecting"
                  : workspaceData?.sourceMode === "client_gateway"
                    ? "Client Gateway"
                    : "Demo Gateway"}
              </span>
              <span className="generated-tag"><Zap size={12} /> Generated in {workspaceSpec.generatedIn}</span>
              <button
                className={`icon-button compact ${filterOpen ? "active-control" : ""}`}
                aria-label="Filter workspace"
                aria-expanded={filterOpen}
                onClick={() => setFilterOpen((value) => !value)}
              >
                <Filter size={15} />
              </button>
              <div className="menu-anchor" ref={workspaceMenuRef}>
                <button
                  className={`icon-button compact ${workspaceMenuOpen ? "active-control" : ""}`}
                  aria-label="More workspace options"
                  aria-expanded={workspaceMenuOpen}
                  onClick={() => setWorkspaceMenuOpen((value) => !value)}
                >
                  <MoreHorizontal size={16} />
                </button>
                {workspaceMenuOpen && (
                  <div className="action-menu workspace-action-menu">
                    <button onClick={() => {
                      void copyText(queryPlan);
                      setToast("Query plan copied");
                      setWorkspaceMenuOpen(false);
                    }}><Copy size={14} /> Copy query plan</button>
                    <button onClick={() => {
                      downloadWorkspaceCsv(workspaceSpec);
                      setToast("Workspace rows exported as CSV");
                      setWorkspaceMenuOpen(false);
                    }}><Download size={14} /> Export CSV</button>
                    <button onClick={() => {
                      setWorkspaceMenuOpen(false);
                      generateWorkspace();
                    }}><RefreshCw size={14} /> Refresh data</button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {filterOpen && (
            <div className="workspace-filter-bar">
              <Search size={14} />
              <input
                value={filterText}
                onChange={(event) => setFilterText(event.target.value)}
                placeholder="Filter visible rows by policy, customer, manager, status…"
                autoFocus
              />
              {filterText && (
                <button aria-label="Clear filter" onClick={() => setFilterText("")}>
                  <X size={13} />
                </button>
              )}
            </div>
          )}

          <div className="result-body">
            <AnimatePresence mode="wait">
              {isGenerating ? (
                <motion.div
                  key="generation"
                  className="generation-stage"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, scale: 0.99 }}
                >
                  <BuildSequence phase={phase} assemblyRef={assemblyRef} />
                </motion.div>
              ) : (
                <motion.div
                  key="workspace"
                  className="rendered-workspace"
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.38 }}
                >
                  {workspaceSpec.blocks.map((block, index) => (
                    <WorkspaceBlockRenderer
                      key={`${workspaceData?.gateway?.decisionId ?? workspaceSpec.generatedIn}-${block.type}-${index}`}
                      block={block}
                      filterText={filterText}
                      setToast={setToast}
                    />
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="inspector-tabs">
            <button className={inspector === "safety" ? "active" : ""} onClick={() => setInspector("safety")}>
              Safety
            </button>
            <button className={inspector === "query" ? "active" : ""} onClick={() => setInspector("query")}>
              Query plan
            </button>
          </div>

          <AnimatePresence mode="wait">
            {inspector === "safety" ? (
              <motion.div
                key="safety"
                className="inspector-content"
                initial={{ opacity: 0, x: -5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 5 }}
              >
                <div className="safety-score">
                  <div className="shield-ring"><ShieldCheck size={22} /></div>
                  <div>
                    <span>Safety envelope</span>
                    <strong>All checks passed</strong>
                  </div>
                </div>
                <div className="rule-list">
                  <SafetyRule
                    icon={Sparkles}
                    label="Workspace planner"
                    value={workspaceData?.planner?.mode === "ai" ? "AI plan · validated" : "Deterministic fallback"}
                  />
                  <SafetyRule
                    icon={Fingerprint}
                    label="Policy authority"
                    value={workspaceData?.gateway?.enforcedBy === "client_gateway" ? "Client Gateway" : "Demo Gateway"}
                  />
                  <SafetyRule
                    icon={LockKeyhole}
                    label="User identity"
                    value={workspaceData?.gateway?.identityProvider === "oidc" ? "Signed OIDC · verified" : "Secure demo identity"}
                  />
                  <SafetyRule icon={Database} label="Access mode" value="Read only" />
                  <SafetyRule
                    icon={Layers3}
                    label="Fields accessed"
                    value={`${workspaceData?.safety.fieldsAccessed ?? 6} of ${workspaceData?.safety.permittedFields ?? 8}`}
                  />
                  <SafetyRule icon={UsersRound} label="Sensitive data" value="Masked" />
                  <SafetyRule
                    icon={ShieldCheck}
                    label="Policy version"
                    value={workspaceData?.gateway?.policyVersion ?? "Waiting for Gateway"}
                  />
                  <SafetyRule
                    icon={Network}
                    label="Catalogue version"
                    value={workspaceData?.gateway?.catalogVersion ?? "Waiting for Gateway"}
                  />
                  <SafetyRule
                    icon={CircleGauge}
                    label="Rows returned"
                    value={`${workspaceData?.safety.returnedRows ?? 24} of ${workspaceData?.safety.maximumRows ?? 200}`}
                  />
                </div>
                <div className="trust-note">
                  <Fingerprint size={16} />
                  <p><strong>The Gateway made the decision.</strong> Morph sent a read-only plan and received only masked, approved results—never database credentials.</p>
                </div>
                <button className="text-button" onClick={() => setInspector("query")}>
                  Inspect query plan <ArrowRight size={14} />
                </button>
              </motion.div>
            ) : (
              <motion.div
                key="query"
                className="inspector-content query-content"
                initial={{ opacity: 0, x: 5 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -5 }}
              >
                <div className="query-heading">
                  <span><Code2 size={14} /> Validated JSON</span>
                  <i>v1.2</i>
                </div>
                <pre>{queryPlan}</pre>
                <div className="query-valid"><CheckCircle2 size={14} /> Identity verified · Gateway approved · no raw SQL</div>
              </motion.div>
            )}
          </AnimatePresence>
        </aside>
      </div>
    </div>
  );
}

function BuildSequence({
  phase,
  assemblyRef,
}: {
  phase: GenerationPhase;
  assemblyRef: React.RefObject<HTMLDivElement | null>;
}) {
  const steps = [
    { id: "understanding", label: "Understanding the request", icon: Sparkles },
    { id: "checking", label: "Checking access policy", icon: ShieldCheck },
    { id: "building", label: "Assembling the interface", icon: Blocks },
  ] as const;
  const order = { understanding: 0, checking: 1, building: 2, ready: 3 };

  return (
    <div className="build-sequence">
      <div className="build-status">
        <motion.div
          className="build-orb"
          animate={{ rotate: 360 }}
          transition={{ duration: 7, ease: "linear", repeat: Infinity }}
        >
          <WandSparkles size={25} />
        </motion.div>
        <div>
          <span>Morph is working</span>
          <strong>{steps.find((step) => step.id === phase)?.label}</strong>
        </div>
      </div>
      <div className="build-steps">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const complete = order[phase] > index;
          const active = order[phase] === index;
          return (
            <div key={step.id} className={`build-step ${complete ? "complete" : ""} ${active ? "active" : ""}`}>
              <span>{complete ? <Check size={13} /> : <Icon size={14} />}</span>
              {step.label}
              {active && <LoaderCircle className="spin" size={14} />}
            </div>
          );
        })}
      </div>
      <div className="assembly-canvas" ref={assemblyRef}>
        <div className="assembly-block assembly-metric" />
        <div className="assembly-block assembly-metric" />
        <div className="assembly-block assembly-metric" />
        <div className="assembly-block assembly-chart" />
        <div className="assembly-block assembly-table" />
      </div>
    </div>
  );
}

function WorkspaceBlockRenderer({
  block,
  filterText,
  setToast,
}: {
  block: WorkspaceBlock;
  filterText: string;
  setToast: (message: string) => void;
}) {
  if (block.type === "metrics") {
    return (
      <div className="metric-grid">
        {block.items.map((metric, index) => (
          <motion.article
            key={metric.label}
            className="metric-card"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.055, duration: 0.3 }}
          >
            <div className={`metric-accent ${metric.tone}`} />
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.delta}</small>
          </motion.article>
        ))}
      </div>
    );
  }

  if (block.type === "filters") {
    return (
      <div className="applied-filter-bar" aria-label="Applied query filters">
        <span><Filter size={14} /> Applied filters</span>
        {block.items.map((item) => (
          <div key={`${item.label}-${item.value}`}>
            <strong>{item.label}</strong>
            <small>{item.value}</small>
          </div>
        ))}
      </div>
    );
  }

  if (block.type === "chart") {
    const maximum = Math.max(...block.items.map((item) => item.value), 1);
    const total = block.items.reduce((sum, item) => sum + item.value, 0);
    const palette = ["#b9f858", "#79a93a", "#4d7ca8", "#ee9a55", "#8d70c9", "#d4d9cc"];
    const donutGradient = block.items.map((item, index) => {
      const startValue = block.items
        .slice(0, index)
        .reduce((sum, candidate) => sum + candidate.value, 0);
      const start = total ? (startValue / total) * 100 : 0;
      const end = total ? ((startValue + item.value) / total) * 100 : 0;
      return `${palette[index % palette.length]} ${start}% ${end}%`;
    }).join(", ");
    const formatter = new Intl.NumberFormat("en-IN", {
      ...(block.valueFormat === "currency"
        ? { style: "currency", currency: "INR", notation: "compact" as const }
        : { notation: "compact" as const }),
      maximumFractionDigits: 1,
    });
    return (
      <article className="chart-card catalog-chart">
        <div className="card-heading">
          <div><strong>{block.title}</strong><span>{block.subtitle}</span></div>
          <span className="chart-kind">{block.variant}</span>
        </div>
        {block.variant === "donut" ? (
          <div className="catalog-donut-wrap">
            <div className="catalog-donut" style={{ background: `conic-gradient(${donutGradient || "#e8ebe3 0 100%"})` }}><span>{formatter.format(total)}</span></div>
            <div className="catalog-donut-legend">{block.items.map((item, index) => <div key={`${item.label}-${index}`}><i style={{ background: palette[index % palette.length] }} /><span>{item.label}</span><strong>{formatter.format(item.value)}</strong></div>)}</div>
          </div>
        ) : block.variant === "line" ? (
          <div className="catalog-line-wrap">
            <svg viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label={block.title}>
              <polyline points={block.items.map((item, index) => `${(index / Math.max(1, block.items.length - 1)) * 100},${48 - (item.value / maximum) * 44}`).join(" ")} />
            </svg>
            <div>{block.items.map((item) => <span key={item.label}>{item.label}</span>)}</div>
          </div>
        ) : (
          <div className="catalog-chart-grid bar">
            {block.items.map((item, index) => (
              <div className="catalog-chart-item" key={`${item.label}-${index}`}>
                <span>{item.label}</span>
                <div aria-label={`${item.label}: ${formatter.format(item.value)}`}>
                  <i style={{ width: `${Math.max(6, (item.value / maximum) * 100)}%` }} />
                </div>
                <strong>{formatter.format(item.value)}</strong>
              </div>
            ))}
          </div>
        )}
      </article>
    );
  }

  if (block.type === "trend") {
    const divisor = Math.max(1, block.values.length - 1);
    const points = block.values
      .map((value, index) => `${(index / divisor) * 100},${98 - value}`)
      .join(" ");
    return (
      <article className="chart-card">
        <div className="card-heading">
          <div>
            <strong>{block.title}</strong>
            <span>{block.subtitle}</span>
          </div>
          <div className="chart-total"><span>Total value</span><strong>{block.total}</strong></div>
        </div>
        <div className="chart-wrap">
          <div className="chart-y-axis">{block.axisLabels.map((label) => <span key={label}>{label}</span>)}</div>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Renewal value rises across the next fifteen days">
            <defs>
              <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#b9f858" stopOpacity="0.34" />
                <stop offset="100%" stopColor="#b9f858" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="area-path" d={`M ${points.replaceAll(" ", " L ")} L 100 100 L 0 100 Z`} />
            <polyline className="line-path" points={points} />
          </svg>
          <div className="chart-labels">
            {block.labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
          </div>
        </div>
      </article>
    );
  }

  return <WorkspaceTable block={block} filterText={filterText} setToast={setToast} />;
}

function WorkspaceTable({
  block,
  filterText,
  setToast,
}: {
  block: TableBlock;
  filterText: string;
  setToast: (message: string) => void;
}) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() =>
    block.columns.map((column) => column.key),
  );
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);
  const [detailRow, setDetailRow] = useState<Record<string, string | number | null> | null>(null);
  const pageSize = 8;
  const columnsMenuRef = useOutsideClick<HTMLDivElement>(
    columnsOpen,
    () => setColumnsOpen(false),
  );

  const normalizedFilter = filterText.trim().toLowerCase();
  const visibleColumns = block.columns.filter((column) =>
    visibleKeys.includes(column.key),
  );
  const filteredRows = normalizedFilter
    ? block.rows.filter((row) =>
        Object.values(row).some((value) =>
          String(value ?? "").toLowerCase().includes(normalizedFilter),
        ),
      )
    : block.rows;
  const sortedRows = sort
    ? [...filteredRows].sort((first, second) => {
        const firstValue = first[sort.key];
        const secondValue = second[sort.key];
        const order = typeof firstValue === "number" && typeof secondValue === "number"
          ? firstValue - secondValue
          : String(firstValue ?? "").localeCompare(String(secondValue ?? ""));
        return sort.direction === "asc" ? order : -order;
      })
    : filteredRows;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const visiblePage = Math.min(page, totalPages - 1);
  const visibleRows = sortedRows.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);

  const toggleColumn = (key: string) => {
    if (visibleKeys.includes(key)) {
      if (visibleKeys.length === 1) {
        setToast("Keep at least one column visible");
        return;
      }
      setVisibleKeys((current) => current.filter((value) => value !== key));
    } else {
      setVisibleKeys((current) => [...current, key]);
    }
  };

  return (
    <article className="table-card">
      <div className="card-heading table-heading">
        <div>
          <strong>{block.title}</strong>
          <span>{sortedRows.length} of {block.totalRows} shown</span>
        </div>
        <div className="menu-anchor" ref={columnsMenuRef}>
          <button
            aria-expanded={columnsOpen}
            onClick={() => setColumnsOpen((value) => !value)}
          >
            <SlidersHorizontal size={13} /> Columns
          </button>
          {columnsOpen && (
            <div className="action-menu columns-menu">
              <strong>Visible columns</strong>
              {block.columns.map((column) => (
                <label key={column.key}>
                  <input
                    type="checkbox"
                    checked={visibleKeys.includes(column.key)}
                    onChange={() => toggleColumn(column.key)}
                  />
                  <span>{column.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>{visibleColumns.map((column) => (
              <th key={column.key}>
                <button
                  className="table-sort"
                  onClick={() => setSort((current) =>
                    current?.key === column.key
                      ? { key: column.key, direction: current.direction === "asc" ? "desc" : "asc" }
                      : { key: column.key, direction: "asc" },
                  )}
                >
                  {column.label}
                  {sort?.key === column.key ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}</tr>
          </thead>
          <tbody>
            {visibleRows.length ? visibleRows.map((row, rowIndex) => (
              <tr key={`${String(row[visibleColumns[0].key])}-${rowIndex}`} onClick={() => setDetailRow(row)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") setDetailRow(row); }}>
                {visibleColumns.map((column) => (
                  <td key={column.key}>{renderTableCell(row[column.key], column.format)}</td>
                ))}
              </tr>
            )) : (
              <tr>
                <td className="empty-table-cell" colSpan={visibleColumns.length}>
                  {normalizedFilter
                    ? `No visible rows contain “${filterText.trim()}”.`
                    : block.emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="table-pagination">
        <span>Page {visiblePage + 1} of {totalPages}</span>
        <div>
          <button disabled={visiblePage === 0} onClick={() => setPage(Math.max(0, visiblePage - 1))}>Previous</button>
          <button disabled={visiblePage + 1 >= totalPages} onClick={() => setPage(Math.min(totalPages - 1, visiblePage + 1))}>Next</button>
        </div>
      </div>
      <AnimatePresence>
        {detailRow && (
          <motion.div className="record-detail" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
            <div><strong>Record details</strong><button aria-label="Close record details" onClick={() => setDetailRow(null)}><X size={15} /></button></div>
            {block.columns.map((column) => (
              <dl key={column.key}><dt>{column.label}</dt><dd>{renderTableCell(detailRow[column.key], column.format)}</dd></dl>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

function renderTableCell(
  value: string | number | null,
  format: TableCellFormat = "text",
) {
  if (value === null || value === "") return <span className="empty-value">—</span>;
  const text = String(value);

  if (format === "id") return <strong>{text}</strong>;
  if (format === "currency") {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(Number(value));
  }
  if (format === "date") {
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(text));
  }
  if (format === "person") {
    const initials = text
      .split(" ")
      .map((part) => part[0])
      .join("")
      .slice(0, 2);
    return <span className="person-cell"><i>{initials}</i>{text}</span>;
  }
  if (format === "badge") {
    const className = text.toLowerCase().replaceAll(" ", "-");
    return <span className={`priority ${className}`}>{text}</span>;
  }
  return text;
}

async function requestDynamicWorkspace(
  prompt: string,
): Promise<DynamicWorkspaceResponse> {
  const response = await fetch("/api/workspaces/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, limit: 200 }),
  });
  const payload = (await response.json()) as
    | DynamicWorkspaceResponse
    | { error?: string; suggestions?: string[] };

  if (!response.ok) {
    const errorPayload = payload as { error?: string; suggestions?: string[] };
    const guidance = errorPayload.suggestions?.slice(0, 2).join(" • ");
    throw new Error(
      guidance
        ? `${errorPayload.error ?? "This request is not supported yet"} Try: ${guidance}`
        : errorPayload.error ?? "The workspace could not be generated.",
    );
  }

  return payload as DynamicWorkspaceResponse;
}

async function requestAppStateBootstrap(): Promise<AppStateBootstrap> {
  const response = await fetch("/api/app-state", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error("Persistent application state is unavailable.");
  }
  return response.json() as Promise<AppStateBootstrap>;
}

async function requestAppStateMutation(action: AppStateAction) {
  const response = await fetch("/api/app-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  if (!response.ok) {
    throw new Error("The change could not be saved to Morph cloud.");
  }
}

async function requestGatewayHealth() {
  const response = await fetch("/api/gateway/health", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const result = (await response.json()) as {
    mode?: "client_gateway" | "secure_demo";
    status?: string;
    policyVersion?: string;
    error?: string;
  };
  if (!response.ok || result.status !== "healthy") {
    throw new Error(result.error ?? "Gateway health check failed.");
  }
  return result;
}

async function requestGatewayCatalog(): Promise<GatewayCatalogPayload> {
  const response = await fetch("/api/gateway/catalog", {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  const result = (await response.json()) as
    | GatewayCatalogPayload
    | { error?: string };
  if (!response.ok || !("entities" in result)) {
    throw new Error(
      "error" in result && result.error
        ? result.error
        : "Gateway catalog discovery failed.",
    );
  }
  return result;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

function normalizeLocalConnector(
  source: Partial<ConnectorRecord>,
): ConnectorRecord {
  const supportedEngine = ["PostgreSQL", "MySQL", "SQL Server"].includes(
    source.engine ?? "",
  )
    ? (source.engine as ConnectorRecord["engine"])
    : "PostgreSQL";
  const supportedStatus = ["draft", "healthy", "unavailable"].includes(
    source.status ?? "",
  )
    ? (source.status as ConnectorRecord["status"])
    : "draft";
  return {
    id: source.id ?? crypto.randomUUID(),
    name: source.name ?? "Connector draft",
    engine: supportedEngine,
    host: source.host ?? "customer-network",
    databaseName: source.databaseName ?? "insurance_operations",
    region: source.region ?? "Mumbai",
    status: supportedStatus,
    lastCheckedAt: source.lastCheckedAt ?? null,
  };
}

function selectPrimaryConnector(connectors: ConnectorRecord[]) {
  return connectors
    .filter((connector) => connector.status === "healthy")
    .reduce<ConnectorRecord | undefined>((latest, connector) => {
      if (!latest) return connector;
      const latestTime = Date.parse(latest.lastCheckedAt ?? "") || 0;
      const connectorTime = Date.parse(connector.lastCheckedAt ?? "") || 0;
      return connectorTime >= latestTime ? connector : latest;
    }, undefined);
}

function auditIcon(action: string) {
  const normalized = action.toLowerCase();
  if (normalized.includes("workspace")) return WandSparkles;
  if (normalized.includes("connector") || normalized.includes("source")) return Database;
  if (normalized.includes("rule") || normalized.includes("permission")) return KeyRound;
  return ShieldCheck;
}

function formatAuditTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function SafetyRule({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: string }) {
  return (
    <div className="safety-rule">
      <span><Icon size={14} /></span>
      <div><small>{label}</small><strong>{value}</strong></div>
      <Check size={13} />
    </div>
  );
}

function SourcesView({
  setToast,
  connectors,
  approvedTables,
  onSaveApprovedTables,
  onActivateConnector,
  persistenceMode,
}: {
  setToast: (message: string) => void;
  connectors: ConnectorRecord[];
  approvedTables: string[];
  onSaveApprovedTables: (
    tables: string[],
    connectorId?: string,
  ) => Promise<void>;
  onActivateConnector: (
    connector: ConnectorRecord,
    catalog: SemanticCatalog,
    selectedEntities: string[],
    policyVersion: string,
  ) => Promise<void>;
  persistenceMode: PersistenceMode;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const sourceMenuRef = useOutsideClick<HTMLDivElement>(
    sourceMenuOpen,
    () => setSourceMenuOpen(false),
  );
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState("32 sec ago");
  const [permissionDraft, setPermissionDraft] = useState(approvedTables);
  const primarySource =
    selectPrimaryConnector(connectors) ??
    defaultConnector;
  const draftSources = connectors.filter((source) => source.status === "draft");

  const runHealthCheck = async () => {
    setSourceMenuOpen(false);
    setChecking(true);
    try {
      const health = await requestGatewayHealth();
      setLastChecked("Just now");
      setToast(
        `${health.mode === "client_gateway" ? "Client Gateway" : "Demo Gateway"} healthy · policy ${health.policyVersion}`,
      );
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message
          : "Gateway health check failed",
      );
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="secondary-page">
      <section className="section-hero">
        <div>
          <span className="page-kicker"><Database size={14} /> Secure connectors</span>
          <h2>Connect data. Keep control.</h2>
          <p>Morph reads only the schema and fields you approve through a gateway in your environment.</p>
        </div>
        <button className="primary-button" onClick={() => setWizardOpen(true)}> <Plus size={16} /> Add data source</button>
      </section>
      <div className="source-layout">
        <article className="connected-source-card">
          <div className="postgres-logo"><Database size={23} /></div>
          <div className="connected-source-main">
            <div className="connected-source-title">
              <div><strong>{primarySource.name}</strong><span>{primarySource.databaseName}</span></div>
              <span className="healthy-badge"><i /> {checking ? "Checking" : "Healthy"}</span>
            </div>
            <div className="source-stats">
              <div><span>Mode</span><strong>Read only</strong></div>
              <div><span>Approved datasets</span><strong>{approvedTables.length} active</strong></div>
              <div><span>Last checked</span><strong>{lastChecked}</strong></div>
              <div><span>Region</span><strong>{primarySource.region}</strong></div>
            </div>
          </div>
          <div className="menu-anchor" ref={sourceMenuRef}>
            <button
              className="icon-button"
              aria-label="PostgreSQL source actions"
              aria-expanded={sourceMenuOpen}
              onClick={() => setSourceMenuOpen((value) => !value)}
            ><MoreHorizontal size={17} /></button>
            {sourceMenuOpen && (
              <div className="action-menu source-action-menu">
                <button onClick={() => void runHealthCheck()}><RefreshCw size={14} /> Test connection</button>
                <button onClick={() => {
                  setSourceMenuOpen(false);
                  setPermissionDraft(approvedTables);
                  setPermissionsOpen(true);
                }}><Settings size={14} /> Request table access</button>
              </div>
            )}
          </div>
        </article>
        <article className="gateway-card">
          <div className="card-heading"><div><strong>Your data never moves</strong><span>Installable Docker Gateway · client operated</span></div><Network size={18} /></div>
          <div className="gateway-flow">
            <div><Database size={19} /><span>Your database</span><small>Private network</small></div>
            <span className="flow-line"><i /></span>
            <div className="gateway-node"><ShieldCheck size={19} /><span>Morph Gateway</span><small>Identity + policy verified</small></div>
            <span className="flow-line"><i /></span>
            <div><Blocks size={19} /><span>Workspace</span><small>Approved results</small></div>
          </div>
          <div className="gateway-note"><LockKeyhole size={14} /> Signed identity is checked before any database access.</div>
        </article>
      </div>

      {draftSources.length > 0 && (
        <section className="draft-connectors">
          <div className="subsection-heading"><div><strong>Connector drafts</strong><span>{persistenceMode === "cloud" ? "Metadata saved to Morph cloud" : "Metadata saved on this device"}</span></div></div>
          <div className="draft-connector-grid">
            {draftSources.map((source) => (
              <article key={source.id}>
                <Database size={17} />
                <div><strong>{source.name}</strong><span>{source.engine} · {source.host}</span></div>
                <span>Setup pending</span>
              </article>
            ))}
          </div>
        </section>
      )}

      {wizardOpen && (
        <ConnectorOnboardingWizard
          onClose={() => setWizardOpen(false)}
          onComplete={async (connector, catalog, selectedEntities) => {
            await onActivateConnector(
              connector,
              {
                catalogVersion: catalog.catalogVersion,
                entities: catalog.entities,
                relationships: catalog.relationships,
              },
              selectedEntities,
              catalog.policyVersion,
            );
            setLastChecked("Just now");
            setWizardOpen(false);
          }}
          setToast={setToast}
        />
      )}

      {permissionsOpen && (
        <Modal title="Request table access" subtitle="Morph stores this request. The client Gateway remains the final authority." onClose={() => setPermissionsOpen(false)}>
          <div className="permission-list">
            {["policies", "claims", "renewals", "endorsements", "customers"].map((table) => (
              <label key={table}>
                <input
                  type="checkbox"
                  checked={permissionDraft.includes(table)}
                  onChange={() => setPermissionDraft((current) => current.includes(table) ? current.filter((value) => value !== table) : [...current, table])}
                />
                <div><strong>{table}</strong><span>Requested read-only access · Gateway approval required</span></div>
              </label>
            ))}
          </div>
          <div className="modal-actions"><button onClick={() => setPermissionsOpen(false)}>Cancel</button><button className="primary-button" onClick={() => {
            void onSaveApprovedTables(permissionDraft, primarySource.id);
            setPermissionsOpen(false);
          }}>Save request</button></div>
        </Modal>
      )}
    </div>
  );
}

const connectorSteps = [
  "Connection",
  "Gateway",
  "Discover",
  "Access",
  "Activate",
] as const;

function ConnectorOnboardingWizard({
  onClose,
  onComplete,
  setToast,
}: {
  onClose: () => void;
  onComplete: (
    connector: ConnectorRecord,
    catalog: GatewayCatalogPayload,
    selectedEntities: string[],
  ) => Promise<void>;
  setToast: (message: string) => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState({
    name: "Claims & policy warehouse",
    host: "db.internal.example",
    databaseName: "insurance_operations",
    region: "Mumbai",
  });
  const [gatewayHealth, setGatewayHealth] = useState<{
    mode: "client_gateway" | "secure_demo";
    policyVersion: string;
  } | null>(null);
  const [catalog, setCatalog] = useState<GatewayCatalogPayload | null>(null);
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testGateway = async () => {
    setChecking(true);
    setError(null);
    try {
      const health = await requestGatewayHealth();
      setGatewayHealth({
        mode: health.mode ?? "secure_demo",
        policyVersion: health.policyVersion ?? "verified-policy",
      });
      setToast("Gateway handshake completed");
    } catch (healthError) {
      setError(
        healthError instanceof Error
          ? healthError.message
          : "Gateway handshake failed.",
      );
    } finally {
      setChecking(false);
    }
  };

  const discoverCatalog = async () => {
    setDiscovering(true);
    setError(null);
    try {
      const result = await requestGatewayCatalog();
      setCatalog(result);
      setSelectedEntities(result.entities.map((entity) => entity.entity));
      setToast(`${result.entities.length} approved datasets discovered`);
    } catch (catalogError) {
      setError(
        catalogError instanceof Error
          ? catalogError.message
          : "Approved schema discovery failed.",
      );
    } finally {
      setDiscovering(false);
    }
  };

  const activate = async () => {
    if (!catalog || !selectedEntities.length) return;
    setActivating(true);
    setError(null);
    try {
      await onComplete(
        {
          id: crypto.randomUUID(),
          name: draft.name.trim(),
          engine: "PostgreSQL",
          host: draft.host.trim(),
          databaseName: draft.databaseName.trim(),
          region: draft.region,
          status: "healthy",
          lastCheckedAt: new Date().toISOString(),
        },
        catalog,
        selectedEntities,
      );
      setToast("PostgreSQL connector activated · read only");
    } catch (activationError) {
      setError(
        activationError instanceof Error
          ? activationError.message
          : "Connector activation failed.",
      );
      setActivating(false);
    }
  };

  const connectionComplete = Boolean(
    draft.name.trim() &&
      draft.host.trim() &&
      draft.databaseName.trim() &&
      draft.region,
  );
  const canContinue =
    (step === 0 && connectionComplete) ||
    (step === 1 && Boolean(gatewayHealth)) ||
    (step === 2 && Boolean(catalog)) ||
    (step === 3 && selectedEntities.length > 0);

  return (
    <Modal
      title="Connect PostgreSQL"
      subtitle="A guided setup that keeps credentials and customer data inside your Gateway."
      onClose={onClose}
      variant="wide"
    >
      <div className="connector-wizard">
        <ol className="connector-stepper" aria-label="Connector setup progress">
          {connectorSteps.map((label, index) => (
            <li
              key={label}
              className={`${index === step ? "active" : ""} ${index < step ? "complete" : ""}`}
            >
              <span>{index < step ? <Check size={12} /> : index + 1}</span>
              <small>{label}</small>
            </li>
          ))}
        </ol>

        <AnimatePresence mode="wait">
          <motion.section
            key={step}
            className="connector-stage"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
          >
            {step === 0 && (
              <>
                <div className="wizard-heading">
                  <span><Database size={16} /></span>
                  <div><strong>Describe the connection</strong><p>Only operational metadata is saved in MorphUI.</p></div>
                </div>
                <div className="wizard-engine"><div className="postgres-logo"><Database size={19} /></div><div><strong>PostgreSQL</strong><span>First production adapter</span></div><CheckCircle2 size={17} /></div>
                <div className="modal-form">
                  <label>Connection name<input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Claims warehouse" /></label>
                  <div className="form-row">
                    <label>Private hostname<input value={draft.host} onChange={(event) => setDraft((current) => ({ ...current, host: event.target.value }))} placeholder="db.internal.example" /></label>
                    <label>Database name<input value={draft.databaseName} onChange={(event) => setDraft((current) => ({ ...current, databaseName: event.target.value }))} placeholder="insurance_operations" /></label>
                  </div>
                  <label>Data region<select value={draft.region} onChange={(event) => setDraft((current) => ({ ...current, region: event.target.value }))}><option>Mumbai</option><option>Hyderabad</option><option>Bengaluru</option><option>Client private cloud</option></select></label>
                </div>
                <div className="secure-form-note"><LockKeyhole size={14} /> Do not enter a username or password here. The PostgreSQL URL exists only in the client-operated Gateway.</div>
              </>
            )}

            {step === 1 && (
              <>
                <div className="wizard-heading">
                  <span><Network size={16} /></span>
                  <div><strong>Verify the client Gateway</strong><p>Confirm the secure service boundary before schema access.</p></div>
                </div>
                <div className="gateway-checklist">
                  <div><span>1</span><p><strong>Gateway installed</strong><small>Docker service runs inside the client network.</small></p></div>
                  <div><span>2</span><p><strong>Read-only role</strong><small>Database credentials remain client-side.</small></p></div>
                  <div><span>3</span><p><strong>OIDC configured</strong><small>Signed identity is required for catalog discovery.</small></p></div>
                </div>
                <div className={`wizard-status ${gatewayHealth ? "success" : ""}`}>
                  <div>{gatewayHealth ? <CheckCircle2 size={18} /> : <RefreshCw size={18} />}</div>
                  <p><strong>{gatewayHealth ? "Gateway handshake verified" : "Ready to test the Gateway"}</strong><small>{gatewayHealth ? `${gatewayHealth.mode === "client_gateway" ? "Client Gateway" : "Secure demo Gateway"} · policy ${gatewayHealth.policyVersion}` : "This check never requests database credentials."}</small></p>
                  <button onClick={() => void testGateway()} disabled={checking}>{checking ? <LoaderCircle className="spin" size={14} /> : <RefreshCw size={14} />} {checking ? "Testing" : gatewayHealth ? "Test again" : "Test Gateway"}</button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <div className="wizard-heading">
                  <span><Layers3 size={16} /></span>
                  <div><strong>Discover the approved catalog</strong><p>The Gateway performs zero-row schema probes and returns no customer records.</p></div>
                </div>
                {!catalog ? (
                  <button className="catalog-discovery" onClick={() => void discoverCatalog()} disabled={discovering}>
                    <span>{discovering ? <LoaderCircle className="spin" size={19} /> : <Database size={19} />}</span>
                    <div><strong>{discovering ? "Verifying approved joins…" : "Run safe discovery"}</strong><small>Identity → policy → PostgreSQL schema · LIMIT 0</small></div>
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <div className="catalog-results">
                    <div className="catalog-summary"><CheckCircle2 size={16} /><div><strong>{catalog.entities.length} datasets verified</strong><span>{catalog.sourceMode === "client_gateway" ? "Client Gateway" : "Secure demo Gateway"} · {catalog.databaseEngine}</span></div></div>
                    <div className="catalog-grid">
                      {catalog.entities.map((entity) => (
                        <article key={entity.entity}><Database size={15} /><div><strong>{formatCatalogName(entity.entity)}</strong><span>{entity.fields.length} fields · {entity.accessMode.replace("_", " ")}</span></div><Check size={13} /></article>
                      ))}
                    </div>
                  </div>
                )}
                <div className="secure-form-note"><ShieldCheck size={14} /> MorphUI receives logical dataset names, permitted fields and masking metadata—not passwords, raw SQL or unrestricted database metadata.</div>
              </>
            )}

            {step === 3 && catalog && (
              <>
                <div className="wizard-heading">
                  <span><ShieldCheck size={16} /></span>
                  <div><strong>Choose approved datasets</strong><p>The client Gateway remains the final authority for every selection.</p></div>
                </div>
                <div className="catalog-permissions">
                  {catalog.entities.map((entity) => {
                    const selected = selectedEntities.includes(entity.entity);
                    return (
                      <label key={entity.entity} className={selected ? "selected" : ""}>
                        <input type="checkbox" checked={selected} onChange={() => setSelectedEntities((current) => selected ? current.filter((value) => value !== entity.entity) : [...current, entity.entity])} />
                        <div><strong>{entity.label}</strong><span>{entity.fields.length} permitted fields · maximum {entity.maximumRows} rows</span><small>{entity.fields.slice(0, 5).map((field) => field.label).join(" · ")}{entity.fields.length > 5 ? " · …" : ""}</small></div>
                        <aside><span>Read only</span>{entity.fields.some((field) => field.masked) && <small>{entity.fields.filter((field) => field.masked).length} masked</small>}</aside>
                      </label>
                    );
                  })}
                </div>
              </>
            )}

            {step === 4 && catalog && (
              <>
                <div className="wizard-heading">
                  <span><CheckCircle2 size={16} /></span>
                  <div><strong>Review and activate</strong><p>Nothing can write to the client database.</p></div>
                </div>
                <div className="activation-review">
                  <div><span>Connection</span><strong>{draft.name}</strong><small>{draft.databaseName} · {draft.region}</small></div>
                  <div><span>Gateway</span><strong>Identity verified</strong><small>{gatewayHealth?.mode === "client_gateway" ? "Client operated" : "Secure demonstration"}</small></div>
                  <div><span>Datasets</span><strong>{selectedEntities.length} approved</strong><small>{selectedEntities.map(formatCatalogName).join(", ")}</small></div>
                  <div><span>Database mode</span><strong>Read only</strong><small>Parameterized plans · zero raw SQL</small></div>
                </div>
                <div className="activation-seal"><ShieldCheck size={20} /><div><strong>Ready for safe activation</strong><p>Morph stores connector metadata and requested datasets. Credentials, signing keys and customer records remain in the client&apos;s infrastructure.</p></div></div>
              </>
            )}
          </motion.section>
        </AnimatePresence>

        {error && <div className="wizard-error"><ShieldCheck size={14} /> {error}</div>}

        <div className="modal-actions wizard-actions">
          <button onClick={step === 0 ? onClose : () => { setError(null); setStep((current) => current - 1); }} disabled={activating}>{step === 0 ? "Cancel" : "Back"}</button>
          {step < 4 ? (
            <button className="primary-button" disabled={!canContinue} onClick={() => { setError(null); setStep((current) => current + 1); }}>Continue <ArrowRight size={14} /></button>
          ) : (
            <button className="primary-button" disabled={activating || !selectedEntities.length} onClick={() => void activate()}>{activating ? <LoaderCircle className="spin" size={14} /> : <CheckCircle2 size={14} />} {activating ? "Activating" : "Activate connector"}</button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function formatCatalogName(value: string) {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function RulesView({
  setToast,
  rules,
  setRules,
}: {
  setToast: (message: string) => void;
  rules: AccessRule[];
  setRules: (rules: AccessRule[]) => void;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AccessRule | null>(null);
  const [ruleMenu, setRuleMenu] = useState<string | null>(null);
  const ruleMenuRef = useOutsideClick<HTMLDivElement>(
    Boolean(ruleMenu),
    () => setRuleMenu(null),
  );
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const [simulatorTeam, setSimulatorTeam] = useState("Operations team");
  const [simulatorScope, setSimulatorScope] = useState("motor_policies");
  const matchingRule = rules.find(
    (rule) =>
      rule.enabled &&
      rule.users === simulatorTeam &&
      rule.scope === simulatorScope,
  );

  const openRuleEditor = (rule: AccessRule | null) => {
    setRuleMenu(null);
    setEditingRule(rule);
    setEditorOpen(true);
  };

  return (
    <div className="secondary-page">
      <section className="section-hero">
        <div>
          <span className="page-kicker"><ShieldCheck size={14} /> Client policy mirror</span>
          <h2>Permissions before prompts.</h2>
          <p>Review the latest policy summary here. The client-hosted Gateway independently verifies and enforces every request.</p>
        </div>
        <button className="primary-button" onClick={() => openRuleEditor(null)}><Plus size={16} /> Draft policy request</button>
      </section>
      <article className="rules-card">
        <div className="rules-header"><span>Rule</span><span>Scope</span><span>Fields</span><span>Mode</span><span>Who can use it</span><span /></div>
        {rules.map((rule) => (
          <div className="rule-row" key={rule.name}>
            <div><span className="rule-icon"><LockKeyhole size={14} /></span><strong>{rule.name}</strong></div>
            <code>{rule.scope}</code>
            <span>{rule.fields}</span>
            <span className={`read-badge ${rule.enabled ? "" : "disabled"}`}>{rule.enabled ? rule.mode : "Disabled"}</span>
            <span>{rule.users}</span>
            <div className="menu-anchor" ref={ruleMenu === rule.id ? ruleMenuRef : undefined}>
              <button
                className="icon-button compact"
                aria-label={`${rule.name} actions`}
                aria-expanded={ruleMenu === rule.id}
                onClick={() => setRuleMenu((current) => current === rule.id ? null : rule.id)}
              ><MoreHorizontal size={15} /></button>
              {ruleMenu === rule.id && (
                <div className="action-menu rule-action-menu">
                  <button onClick={() => openRuleEditor(rule)}><Settings size={14} /> Edit draft</button>
                  <button onClick={() => {
                    setRules(rules.map((item) => item.id === rule.id ? { ...item, enabled: !item.enabled } : item));
                    setRuleMenu(null);
                    setToast(`${rule.name} change drafted · Gateway approval required`);
                  }}><ShieldCheck size={14} /> Propose {rule.enabled ? "disable" : "enable"}</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </article>
      <div className="policy-callout">
        <div className="callout-orb"><Fingerprint size={21} /></div>
        <div><strong>The client Gateway is the final authority.</strong><p>Morph can display and draft policy changes, but only the Gateway can grant data access.</p></div>
        <button onClick={() => setSimulatorOpen(true)}>Open policy simulator <ArrowRight size={14} /></button>
      </div>

      {editorOpen && (
        <Modal
          title={editingRule ? "Edit policy request" : "Draft policy request"}
          subtitle="Saving this draft does not grant access. A client administrator must publish it in the Gateway."
          onClose={() => setEditorOpen(false)}
        >
          <form
            className="modal-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const nextRule: AccessRule = {
                id: editingRule?.id ?? crypto.randomUUID(),
                name: String(form.get("name") ?? "").trim(),
                scope: String(form.get("scope") ?? "").trim(),
                fields: `${String(form.get("fields") ?? "8")} fields`,
                mode: "Read only",
                users: String(form.get("users") ?? "Operations team"),
                enabled: editingRule?.enabled ?? true,
              };
              setRules(editingRule ? rules.map((rule) => rule.id === editingRule.id ? nextRule : rule) : [...rules, nextRule]);
              setEditorOpen(false);
              setToast("Policy request saved · Gateway approval required");
            }}
          >
            <label>Rule name<input name="name" required defaultValue={editingRule?.name ?? ""} placeholder="Renewal operations" /></label>
            <label>Dataset scope<input name="scope" required defaultValue={editingRule?.scope ?? ""} placeholder="renewals_summary" pattern="[a-z0-9_]+" /></label>
            <div className="form-row">
              <label>Permitted fields<input name="fields" type="number" min="1" max="30" defaultValue={editingRule?.fields.split(" ")[0] ?? "8"} /></label>
              <label>Team<select name="users" defaultValue={editingRule?.users ?? "Operations team"}><option>Operations team</option><option>Claims managers</option><option>Support leads</option><option>Workspace admins</option></select></label>
            </div>
            <div className="secure-form-note"><ShieldCheck size={14} /> This is a non-authoritative request. The client Gateway validates identity, fields and row limits.</div>
            <div className="modal-actions"><button type="button" onClick={() => setEditorOpen(false)}>Cancel</button><button className="primary-button" type="submit">Save request</button></div>
          </form>
        </Modal>
      )}

      {simulatorOpen && (
        <Modal title="Policy mirror simulator" subtitle="Pre-check against the latest synchronized summary. The Gateway makes the real decision." onClose={() => setSimulatorOpen(false)}>
          <div className="simulator-controls form-row">
            <label>Team<select value={simulatorTeam} onChange={(event) => setSimulatorTeam(event.target.value)}><option>Operations team</option><option>Claims managers</option><option>Support leads</option><option>Workspace admins</option></select></label>
            <label>Dataset<select value={simulatorScope} onChange={(event) => setSimulatorScope(event.target.value)}>{Array.from(new Set(rules.map((rule) => rule.scope))).map((scope) => <option key={scope}>{scope}</option>)}</select></label>
          </div>
          <div className={`simulation-result ${matchingRule ? "allowed" : "denied"}`}>
            {matchingRule ? <CheckCircle2 size={21} /> : <LockKeyhole size={21} />}
            <div><span>Expected result</span><strong>{matchingRule ? "Likely allowed" : "Likely denied"}</strong><p>{matchingRule ? `${matchingRule.fields} appear available through ${matchingRule.name}; the Gateway will verify this.` : "The current mirror has no enabled rule for this team and dataset."}</p></div>
          </div>
          <div className="modal-actions"><button onClick={() => setSimulatorOpen(false)}>Close</button><button className="primary-button" onClick={() => setToast("Simulation recorded as a non-authoritative pre-check")}>Record pre-check</button></div>
        </Modal>
      )}
    </div>
  );
}

type AuditDisplayEvent = {
  id: string;
  action: string;
  actor: string;
  target: string;
  time: string;
  icon: typeof Database;
  outcome: "success" | "denied" | "failure";
  requestId: string;
  details: Record<string, unknown>;
};

function AuditView({
  setToast,
  events,
}: {
  setToast: (message: string) => void;
  events: AuditEventRecord[];
}) {
  const [range, setRange] = useState("Last 7 days");
  const [rangeOpen, setRangeOpen] = useState(false);
  const rangeMenuRef = useOutsideClick<HTMLDivElement>(
    rangeOpen,
    () => setRangeOpen(false),
  );
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [actor, setActor] = useState("All actors");
  const displayEvents: AuditDisplayEvent[] = events.length
    ? events.map((event) => ({
        ...event,
        time: formatAuditTime(event.createdAt),
        icon: auditIcon(event.action),
      }))
    : auditEvents.map((event, index) => ({
        ...event,
        id: `demo-audit-${index}`,
        outcome: "success" as const,
        requestId: `req_demo_${index + 1}`,
        details: {},
      }));
  const [selectedEvent, setSelectedEvent] = useState<AuditDisplayEvent | null>(null);
  const visibleEvents = actor === "All actors"
    ? displayEvents
    : displayEvents.filter((event) => event.actor === actor);

  return (
    <div className="secondary-page">
      <section className="section-hero">
        <div>
          <span className="page-kicker"><Activity size={14} /> Complete traceability</span>
          <h2>Every action, accounted for.</h2>
          <p>See the prompt, validated plan, policy decision, and result metadata for each request.</p>
        </div>
        <div className="menu-anchor" ref={rangeMenuRef}>
          <button className="outline-button" onClick={() => setRangeOpen((value) => !value)} aria-expanded={rangeOpen}><Clock3 size={15} /> {range} <ChevronDown size={13} /></button>
          {rangeOpen && (
            <div className="action-menu range-menu">
              {["Last 24 hours", "Last 7 days", "Last 30 days"].map((option) => (
                <button key={option} onClick={() => {
                  setRange(option);
                  setRangeOpen(false);
                  setToast(`Audit range changed to ${option.toLowerCase()}`);
                }}>{range === option ? <Check size={14} /> : <Clock3 size={14} />}{option}</button>
              ))}
            </div>
          )}
        </div>
      </section>
      <article className="audit-card">
        <div className="audit-toolbar"><div><strong>Recent activity</strong><span>{visibleEvents.length} events · {range.toLowerCase()}</span></div><button className={filtersOpen ? "active-control" : ""} onClick={() => setFiltersOpen((value) => !value)}><Filter size={14} /> Filter</button></div>
        {filtersOpen && (
          <div className="audit-filters">
            <label>Actor<select value={actor} onChange={(event) => setActor(event.target.value)}><option>All actors</option>{Array.from(new Set(displayEvents.map((event) => event.actor))).map((value) => <option key={value}>{value}</option>)}</select></label>
            <span>{visibleEvents.length} matching events</span>
            {actor !== "All actors" && <button onClick={() => setActor("All actors")}><X size={12} /> Clear</button>}
          </div>
        )}
        <div className="audit-list">
          {visibleEvents.map((event) => {
            const Icon = event.icon;
            return (
              <div className="audit-row" key={event.id}>
                <span className="audit-icon"><Icon size={16} /></span>
                <div><strong>{event.action}</strong><span>{event.actor}</span></div>
                <code>{event.target}</code>
                <time>{event.time}</time>
                <button className="icon-button compact" aria-label={`View ${event.action} details`} onClick={() => setSelectedEvent(event)}><ArrowRight size={14} /></button>
              </div>
            );
          })}
        </div>
      </article>
      {selectedEvent && (
        <Modal title={selectedEvent.action} subtitle="Immutable audit event details" onClose={() => setSelectedEvent(null)}>
          <dl className="event-details">
            <div><dt>Actor</dt><dd>{selectedEvent.actor}</dd></div>
            <div><dt>Target</dt><dd>{selectedEvent.target}</dd></div>
            <div><dt>Time</dt><dd>{selectedEvent.time}</dd></div>
            <div><dt>Outcome</dt><dd><span className="healthy-badge"><i /> {capitalize(selectedEvent.outcome)}</span></dd></div>
            <div><dt>Request ID</dt><dd><code>{selectedEvent.requestId}</code></dd></div>
          </dl>
          <div className="modal-actions"><button onClick={() => setSelectedEvent(null)}>Close</button><button className="primary-button" onClick={() => {
            void copyText(JSON.stringify(selectedEvent, null, 2));
            setToast("Audit event copied as JSON");
          }}><Copy size={14} /> Copy JSON</button></div>
        </Modal>
      )}
    </div>
  );
}

function GlobalOverlay({
  overlay,
  onClose,
  onNavigate,
  onSelectPrompt,
  savedWorkspaces,
  onOpenSaved,
  unreadNotifications,
  persistenceMode,
  activeUser,
  emailAlerts,
  onSavePreferences,
  onMarkNotificationsRead,
  setToast,
}: {
  overlay: Exclude<AppOverlay, null>;
  onClose: () => void;
  onNavigate: (section: SectionId) => void;
  onSelectPrompt: (prompt: string) => void;
  savedWorkspaces: SavedWorkspace[];
  onOpenSaved: (workspace: SavedWorkspace) => void;
  unreadNotifications: number;
  persistenceMode: PersistenceMode;
  activeUser: AppStateBootstrap["user"];
  emailAlerts: boolean;
  onSavePreferences: (emailAlerts: boolean) => Promise<void>;
  onMarkNotificationsRead: () => void;
  setToast: (message: string) => void;
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [emailAlertsDraft, setEmailAlertsDraft] = useState(emailAlerts);
  const promptCommands = [
    ["Upcoming renewals", "Show motor policies expiring in the next 15 days above ₹20,000."],
    ["High-value claims", "Show high-value claims reported this month by branch."],
    ["Pending endorsements", "Show pending endorsements grouped by type."],
    ["Policy portfolio", "Show the active policy portfolio by product."],
  ] as const;

  if (overlay === "search") {
    const normalized = searchQuery.trim().toLowerCase();
    const matchingNav = navItems.filter((item) => item.label.toLowerCase().includes(normalized));
    const matchingPrompts = promptCommands.filter(([label, prompt]) => `${label} ${prompt}`.toLowerCase().includes(normalized));
    const matchingSaved = savedWorkspaces.filter((item) => `${item.title} ${item.prompt}`.toLowerCase().includes(normalized));

    return (
      <Modal title="Search MorphUI" subtitle="Navigate or start a workspace request." onClose={onClose} variant="command">
        <div className="command-search"><Search size={17} /><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search pages, requests, and saved workspaces" /><kbd>Esc</kbd></div>
        <div className="command-results">
          {matchingNav.length > 0 && <p>Navigate</p>}
          {matchingNav.map((item) => {
            const Icon = item.icon;
            return <button key={item.id} onClick={() => onNavigate(item.id)}><span><Icon size={15} /></span><div><strong>{item.label}</strong><small>Open product section</small></div><ChevronRight size={14} /></button>;
          })}
          {matchingPrompts.length > 0 && <p>Workspace prompts</p>}
          {matchingPrompts.map(([label, prompt]) => <button key={label} onClick={() => onSelectPrompt(prompt)}><span><WandSparkles size={15} /></span><div><strong>{label}</strong><small>{prompt}</small></div><ChevronRight size={14} /></button>)}
          {matchingSaved.length > 0 && <p>{persistenceMode === "cloud" ? "Saved in Morph cloud" : "Saved on this device"}</p>}
          {matchingSaved.map((item) => <button key={item.id} onClick={() => onOpenSaved(item)}><span><Save size={15} /></span><div><strong>{item.title}</strong><small>{item.prompt}</small></div><ChevronRight size={14} /></button>)}
          {!matchingNav.length && !matchingPrompts.length && !matchingSaved.length && <div className="command-empty"><Search size={20} /><strong>No matching actions</strong><span>Try “claims”, “rules”, or “renewals”.</span></div>}
        </div>
        <div className="command-footer"><span><kbd>Ctrl</kbd><kbd>K</kbd> open search</span><span><kbd>/</kbd> quick open</span></div>
      </Modal>
    );
  }

  if (overlay === "notifications") {
    return (
      <Modal title="Notifications" subtitle={`${unreadNotifications} unread updates`} onClose={onClose} variant="panel">
        <div className="notification-list">
          <article className={unreadNotifications ? "unread" : ""}><span><ShieldCheck size={15} /></span><div><strong>Policy check passed</strong><p>Your latest workspace used 8 approved fields.</p><time>2 min ago</time></div></article>
          <article className={unreadNotifications ? "unread" : ""}><span><Database size={15} /></span><div><strong>Data source healthy</strong><p>PostgreSQL responded within the expected threshold.</p><time>18 min ago</time></div></article>
          <article><span><Save size={15} /></span><div><strong>Workspace saved</strong><p>Motor renewals is available {persistenceMode === "cloud" ? "across your sessions" : "on this device"}.</p><time>Yesterday</time></div></article>
        </div>
        <div className="modal-actions"><button onClick={onClose}>Close</button><button className="primary-button" onClick={onMarkNotificationsRead}><CheckCheck size={14} /> Mark all read</button></div>
      </Modal>
    );
  }

  if (overlay === "profile") {
    return (
      <Modal title="Profile & preferences" subtitle="Workspace administrator" onClose={onClose} variant="panel">
        <div className="profile-summary"><div className="profile-avatar large">{initials(activeUser.fullName)}</div><div><strong>{activeUser.fullName}</strong><span>{activeUser.email}</span></div></div>
        <div className="preference-list">
          <label><span><Mail size={15} /><div><strong>Email safety alerts</strong><small>Send a summary when a request is denied.</small></div></span><input type="checkbox" checked={emailAlertsDraft} onChange={(event) => setEmailAlertsDraft(event.target.checked)} /></label>
          <button onClick={() => {
            onNavigate("rules");
            setToast("Opened access rules");
          }}><span><ShieldCheck size={15} /><div><strong>Manage access rules</strong><small>Review team permissions.</small></div></span><ChevronRight size={14} /></button>
          <button onClick={() => {
            void copyText(activeUser.email);
            setToast("Account email copied");
          }}><span><Copy size={15} /><div><strong>Copy account email</strong><small>{activeUser.email}</small></div></span><ChevronRight size={14} /></button>
        </div>
        <div className="modal-actions"><button className="primary-button" onClick={() => {
          void onSavePreferences(emailAlertsDraft);
          onClose();
        }}>Save preferences</button></div>
      </Modal>
    );
  }

  return (
    <Modal title="Choose workspace" subtitle="Your available organization environments" onClose={onClose} variant="panel">
      <div className="organization-list">
        <button className="active" onClick={() => {
          onClose();
          setToast("Atlas Insurance is already active");
        }}><span className="org-avatar">AI</span><div><strong>Atlas Insurance</strong><small>Operations · Mumbai data region</small></div><CheckCircle2 size={16} /></button>
      </div>
      <div className="workspace-meta"><div><span>Role</span><strong>Workspace admin</strong></div><div><span>Environment</span><strong>Production demo</strong></div></div>
      <div className="secure-form-note"><LockKeyhole size={14} /> Switching workspaces never changes the underlying access policy.</div>
      <div className="modal-actions"><button onClick={onClose}>Close</button><button className="primary-button" onClick={() => onNavigate("sources")}><Database size={14} /> Manage sources</button></div>
    </Modal>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
  variant = "default",
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  variant?: "default" | "command" | "panel" | "wide";
}) {
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <motion.div className="modal-backdrop" role="presentation" onMouseDown={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.section className={`modal-card ${variant}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()} initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }} transition={spring}>
        <header><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button compact" aria-label="Close dialog" onClick={onClose}><X size={15} /></button></header>
        <div className="modal-body">{children}</div>
      </motion.section>
    </motion.div>
  );
}

function useOutsideClick<T extends HTMLElement>(
  open: boolean,
  onDismiss: () => void,
) {
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onDismiss();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, onDismiss]);

  return ref;
}

function readLocalArray<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T[] : [];
  } catch {
    return [];
  }
}

function writeLocalArray<T>(key: string, value: T[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Device storage is optional; the current session still keeps the update.
  }
}

function readLocalBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function writeLocalBoolean(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Device storage is optional; the current session still keeps the update.
  }
}

async function copyText(value: string) {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function downloadWorkspaceCsv(spec: WorkspaceSpec) {
  const table = spec.blocks.find((block): block is TableBlock => block.type === "table");
  if (!table) return;
  const header = table.columns.map((column) => escapeCsv(column.label)).join(",");
  const rows = table.rows.map((row) => table.columns.map((column) => escapeCsv(row[column.key])).join(","));
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${spec.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "morph-workspace"}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function MorphMark() {
  return (
    <span className="morph-mark" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
  );
}
