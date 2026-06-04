/* App root — the composition shell. Reads top-down: types, the two behavioral
   hooks (navigation / source actions), then App wiring them into a Topbar +
   routed frame + overlay layer under the ThemeProvider. Every concrete view
   lives in its own feature package. */
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import type {
  Edge,
  FieldDef,
  LineageNode,
  ProjectSummary,
} from "../lib/catalog";
import { AllChats } from "./AllChats";
import { ThemeProvider, useTheme } from "./AppShell/ThemeProvider";
import { ModelPicker, ProjectPicker } from "./Breadcrumb";
import { AssistantOverlay, TerminalAssistant } from "./Chat";
import { ColdStorageModal } from "./ColdStorage";
import { ExportDrawer } from "./Export";
import { catalog } from "./fixtureSource";
import { ModelDetail } from "./ModelDetail";
import { OrgSettings } from "./OrgSettings";
import { Icon } from "./primitives";
import { ConfirmArchive, UploadModal } from "./Upload";
import { useCatalog } from "./useCatalog";
import { Workspace } from "./Workspace";

/** A route, plus the optional payload some routes carry. Kept deliberately loose
    so go()/setRoute share one shape; model routes carry a node. */
type Route = { name: string; node?: LineageNode; nodeId?: string | null };

/** The payload the upload modal emits when a brand-new source is created. */
type NewSource = {
  name: string;
  schema: FieldDef[] | null;
  files: { name: string; rows: number; when: string }[];
};

// ── navigation ───────────────────────────────────────────────────────────────
// Where you are (route + current project) and the assistant dock. go() is the
// intent dispatcher leaf views call ("open this recent", "open the assistant");
// openModel/selectProject/toggleOrg are the direct moves the shell makes.
function useNavigation() {
  const projects = catalog.listProjects();
  const [route, setRoute] = useState<Route>({ name: "workspace" });
  const [projectId, setProjectId] = useState(projects[0].id);
  const [chatOpen, setChatOpen] = useState(false);
  const beforeOrgRef = useRef<Route>({ name: "workspace" });

  const openChat = useCallback(() => setChatOpen(true), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const openModel = useCallback(
    (node: LineageNode) => setRoute({ name: "model", node }),
    [],
  );
  const selectProject = useCallback((p: ProjectSummary) => {
    setProjectId(p.id);
    setRoute({ name: "workspace" });
  }, []);
  const toggleOrg = useCallback(() => {
    setRoute((r) => {
      if (r.name === "org")
        return beforeOrgRef.current || { name: "workspace" };
      beforeOrgRef.current = r;
      return { name: "org" };
    });
  }, []);
  const go = useCallback((r: Route) => {
    if (r.name === "openRecent") {
      const node = r.nodeId ? catalog.getNode(r.nodeId) : null;
      if (node && node.ref) {
        setRoute({ name: "model", node });
        setChatOpen(true);
        return;
      }
      setRoute({ name: "workspace" });
      setChatOpen(true);
      return;
    }
    if (r.name === "assistant") {
      setChatOpen(true);
      return;
    }
    setRoute(r);
  }, []);

  const projectName = (projects.find((p) => p.id === projectId) || projects[0])
    .name;

  return {
    route,
    setRoute,
    projectId,
    projectName,
    go,
    openModel,
    selectProject,
    toggleOrg,
    chatOpen,
    openChat,
    closeChat,
  };
}
type NavApi = ReturnType<typeof useNavigation>;

// ── source actions ───────────────────────────────────────────────────────────
// The data-workspace overlays (upload, export, cold storage, archive-confirm)
// and the catalog mutations behind them. justAdded briefly flags a freshly
// created node so the canvas can pop it.
function useSourceActions() {
  const [upload, setUpload] = useState<{
    open: boolean;
    source: LineageNode | null;
  }>({ open: false, source: null });
  const [exportOpen, setExportOpen] = useState(false);
  const [coldOpen, setColdOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState<LineageNode | null>(
    null,
  );
  const [justAdded, setJustAdded] = useState<string | null>(null);

  const flashAdded = useCallback((id: string) => {
    setJustAdded(id);
    setTimeout(() => setJustAdded(null), 1600);
  }, []);
  const openUpload = useCallback(
    (source: LineageNode | null) => setUpload({ open: true, source }),
    [],
  );
  const closeUpload = useCallback(
    () => setUpload({ open: false, source: null }),
    [],
  );
  const openExport = useCallback(() => setExportOpen(true), []);
  const closeExport = useCallback(() => setExportOpen(false), []);
  const openCold = useCallback(() => setColdOpen(true), []);
  const closeCold = useCallback(() => setColdOpen(false), []);
  const requestArchive = useCallback(
    (src: LineageNode) => setConfirmArchive(src),
    [],
  );
  const cancelArchive = useCallback(() => setConfirmArchive(null), []);

  const createSource = useCallback(
    (src: NewSource) => {
      const id =
        "src." +
        (src.name || "source")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "") +
        "_" +
        Math.random().toString(36).slice(2, 5);
      const node: LineageNode = {
        id,
        label: src.name,
        sub: "source",
        layer: "source",
        schema: src.schema ?? undefined,
        files: src.files,
      };
      catalog.addSource(node);
      flashAdded(id);
    },
    [flashAdded],
  );
  const createModel = useCallback(
    (node: LineageNode, edge: Edge) => {
      catalog.addModel(node, edge);
      flashAdded(node.id);
    },
    [flashAdded],
  );
  const renameSource = useCallback(
    (id: string, name: string) => catalog.renameSource(id, name),
    [],
  );
  const archiveSource = useCallback(
    (src: LineageNode) => {
      catalog.archiveSource(src);
      setConfirmArchive(null);
      closeUpload();
    },
    [closeUpload],
  );
  const restoreSource = useCallback(
    (id: string) => catalog.restoreSource(id),
    [],
  );

  return {
    upload,
    openUpload,
    closeUpload,
    exportOpen,
    openExport,
    closeExport,
    coldOpen,
    openCold,
    closeCold,
    confirmArchive,
    requestArchive,
    cancelArchive,
    archiveSource,
    createSource,
    createModel,
    renameSource,
    restoreSource,
    justAdded,
  };
}
type SourceApi = ReturnType<typeof useSourceActions>;

// ── App (composition root) ───────────────────────────────────────────────────
function App() {
  const nav = useNavigation();
  const sources = useSourceActions();
  // Re-render the shell on any catalog mutation (rename/archive/restore/add).
  const catalogVersion = useCatalog();
  const models = useMemo(() => catalog.listModels(), [catalogVersion]);
  const { rootClassName } = useTheme();

  // Opening a lineage node bridges the two domains: a source opens its upload
  // window, anything else routes to the model detail view.
  const onOpenNode = (node: LineageNode) => {
    if (node.layer === "source") sources.openUpload(node);
    else nav.openModel(node);
  };

  return (
    <div
      className={rootClassName + (nav.route.name === "org" ? " org-open" : "")}
    >
      <div className="main">
        <Topbar nav={nav} sources={sources} models={models} />
        <RouteFrame
          nav={nav}
          onOpenNode={onOpenNode}
          justAdded={sources.justAdded}
        />
      </div>
      <Overlays nav={nav} sources={sources} />
    </div>
  );
}

// ── topbar: org badge + breadcrumb + data-action buttons ─────────────────────
function Topbar({
  nav,
  sources,
  models,
}: {
  nav: NavApi;
  sources: SourceApi;
  models: LineageNode[];
}) {
  const { route } = nav;
  const coldCount = catalog.listColdStorage().length;
  return (
    <div className="topbar">
      <div className="topbar-inner">
        <div className="breadcrumb">
          <button
            className={"org-badge-btn" + (route.name === "org" ? " on" : "")}
            onClick={nav.toggleOrg}
            title={
              route.name === "org"
                ? "Close organization"
                : "Organization settings"
            }
          >
            <span className="bd-face bd-d">{catalog.getOrg().name[0]}</span>
            <span className="bd-face bd-x">
              <Icon name="x" size={17} />
            </span>
          </button>
          <div className="bc-rest">
            <span className="brand-sep">/</span>
            {route.name === "model" ? (
              <>
                <button
                  className="crumb-link"
                  onClick={() => nav.setRoute({ name: "workspace" })}
                >
                  {nav.projectName}
                </button>
                <span className="sep">/</span>
                <ModelPicker
                  current={route.node!}
                  models={models}
                  onSelect={nav.openModel}
                />
              </>
            ) : (
              <>
                <ProjectPicker
                  projectId={nav.projectId}
                  onSelect={nav.selectProject}
                />
                {route.name === "chats" && (
                  <>
                    <span className="sep">/</span>
                    <span className="current">All Chats</span>
                  </>
                )}
                {route.name === "engines" && (
                  <>
                    <span className="sep">/</span>
                    <span className="current">Query Engines</span>
                  </>
                )}
              </>
            )}
          </div>
        </div>
        <div className="topbar-actions">
          <div className="icon-group nolead">
            <button
              className="icon-btn"
              title="Upload a source"
              onClick={() => sources.openUpload(null)}
            >
              <Icon name="upload" />
            </button>
            <button
              className="icon-btn"
              title="Export dbt project"
              onClick={sources.openExport}
            >
              <Icon name="download" />
            </button>
            <button
              className="icon-btn"
              title="Query engines"
              onClick={() => nav.setRoute({ name: "engines" })}
            >
              <Icon name="database" />
            </button>
            <button
              className="icon-btn cold-btn-toolbar"
              title="Cold storage"
              onClick={sources.openCold}
            >
              <Icon name="fridge" />
              {coldCount > 0 && <span className="cold-count">{coldCount}</span>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── routed content: one view per route ───────────────────────────────────────
function RouteFrame({
  nav,
  onOpenNode,
  justAdded,
}: {
  nav: NavApi;
  onOpenNode: (node: LineageNode) => void;
  justAdded: string | null;
}) {
  const { route } = nav;
  const { dark, toggleDark } = useTheme();
  const views: Record<string, () => ReactNode> = {
    workspace: () => <Workspace onOpen={onOpenNode} justAdded={justAdded} />,
    model: () => <ModelDetail node={route.node!} onOpen={nav.openModel} />,
    engines: () => (
      <Stub
        title="Query Engines"
        sub="DuckDB · connected. Manage compute for previews and exports."
      />
    ),
    chats: () => <AllChats go={nav.go} />,
    org: () => <OrgSettings dark={dark} onToggleDark={toggleDark} />,
  };
  return (
    <div className="content">
      <div className="frame">{(views[route.name] ?? (() => null))()}</div>
    </div>
  );
}

// ── overlay layer: assistant dock + the data-workspace modals ────────────────
function Overlays({ nav, sources }: { nav: NavApi; sources: SourceApi }) {
  const { route } = nav;
  const { dark } = useTheme();
  const chatContext = route.name === "model" ? (route.node ?? null) : null;
  return (
    <>
      {!nav.chatOpen && route.name !== "org" && (
        <button
          className="assistant-fab"
          onClick={nav.openChat}
          aria-label="Assistant"
        >
          <Icon name="sparkle" size={23} />
        </button>
      )}
      {nav.chatOpen && <div className="ao-scrim" onClick={nav.closeChat} />}
      {nav.chatOpen &&
        (dark ? (
          <TerminalAssistant
            context={chatContext}
            onCreate={sources.createModel}
            onClose={nav.closeChat}
            onOpenNode={nav.openModel}
            go={nav.go}
          />
        ) : (
          <AssistantOverlay
            context={chatContext}
            onCreate={sources.createModel}
            onClose={nav.closeChat}
            onOpenNode={nav.openModel}
            go={nav.go}
          />
        ))}
      {sources.exportOpen && <ExportDrawer onClose={sources.closeExport} />}
      {sources.upload.open && (
        <UploadModal
          key={sources.upload.source ? sources.upload.source.id : "new-upload"}
          source={sources.upload.source}
          onClose={sources.closeUpload}
          onCreateSource={sources.createSource}
          onRename={sources.renameSource}
          onArchive={sources.requestArchive}
        />
      )}
      {sources.confirmArchive && (
        <ConfirmArchive
          source={sources.confirmArchive}
          onCancel={sources.cancelArchive}
          onConfirm={sources.archiveSource}
        />
      )}
      {sources.coldOpen && (
        <ColdStorageModal
          items={catalog.listColdStorage()}
          onRestore={sources.restoreSource}
          onClose={sources.closeCold}
        />
      )}
    </>
  );
}

function Stub({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ padding: 40 }}>
      <h1 className="serif" style={{ fontSize: 22, color: "var(--text-900)" }}>
        {title}
      </h1>
      <p style={{ color: "var(--text-500)" }}>{sub}</p>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl)
  createRoot(rootEl).render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
