/* App root — routing, workspace (layered lineage home), tweaks, chat, export */

function WelcomeScreen({ go, openChat }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 24 }}>
      <h1 className="serif" style={{ fontSize: 26, margin: "0 0 10px", color: "var(--text-900)" }}>Welcome to Dashboard Chat</h1>
      <p style={{ color: "var(--text-500)", maxWidth: 440, lineHeight: 1.55, margin: "0 0 22px" }}>
        Start a conversation to clean, join and aggregate your data using natural language — organized into dbt staging, intermediate and mart layers.
      </p>
      <div style={{ display: "flex", gap: 12 }}>
        <button className="btn" onClick={openChat}><Icon name="plus" size={15} />Upload a CSV</button>
        <button className="btn" onClick={() => go({ name: "workspace" })}><Icon name="folder" size={15} />Browse Projects</button>
      </div>
    </div>
  );
}

function Stub({ title, sub }) {
  return (
    <div style={{ padding: 40 }}>
      <h1 className="serif" style={{ fontSize: 22, color: "var(--text-900)" }}>{title}</h1>
      <p style={{ color: "var(--text-500)" }}>{sub}</p>
    </div>
  );
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "lineageMode": "dag",
  "theme": "Neobrutalist",
  "dark": false,
  "accent": "#3b82f6",
  "layerPalette": ["#2563eb", "#7c3aed", "#047857"],
  "auditBadges": true,
  "surface": "warm",
  "canvasGrid": true,
  "headingFont": "Bricolage Grotesque"
}/*EDITMODE-END*/;

function App() {
  const projects = catalog.listProjects();
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [route, setRoute] = useState({ name: "workspace" });
  const [projectId, setProjectId] = useState(projects[0].id);
  const [chatOpen, setChatOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [upload, setUpload] = useState({ open: false, source: null });
  const [coldOpen, setColdOpen] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const [justAdded, setJustAdded] = useState(null);
  // Subscribe App to catalog mutations: any rename/archive/restore/live-add
  // bumps the version and re-renders the tree. Used as a memo dep below.
  const catalogVersion = useCatalog();

  const go = useCallback((r) => {
    if (r.name === "openRecent") {
      const node = catalog.getNode(r.nodeId);
      if (node && node.ref) { setRoute({ name: "model", node }); setChatOpen(true); return; }
      setRoute({ name: "workspace" }); setChatOpen(true); return;
    }
    if (r.name === "assistant") { setChatOpen(true); return; }
    setRoute(r);
  }, []);
  const beforeOrgRef = useRef({ name: "workspace" });
  const toggleOrg = useCallback(() => {
    setRoute((r) => {
      if (r.name === "org") return beforeOrgRef.current || { name: "workspace" };
      beforeOrgRef.current = r;
      return { name: "org" };
    });
  }, []);
  const openModel = useCallback((node) => setRoute({ name: "model", node }), []);
  const onOpenNode = useCallback((node) => {
    if (node.layer === "source") {
      // The node already carries any rename via the graph projection.
      setUpload({ open: true, source: node });
      return;
    }
    setRoute({ name: "model", node });
  }, []);
  const renameSource = useCallback((id, name) => catalog.renameSource(id, name), []);
  const archiveSource = useCallback((src) => {
    catalog.archiveSource(src);
    setConfirmArchive(null);
    setUpload({ open: false, source: null });
  }, []);
  const restoreSource = useCallback((id) => catalog.restoreSource(id), []);
  const handleCreateSource = useCallback((src) => {
    const id = "src." + (src.name || "source").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + Math.random().toString(36).slice(2, 5);
    const node = { id, label: src.name, sub: "source", layer: "source", schema: src.schema, files: src.files, ref: null };
    catalog.addSource(node);
    setJustAdded(id); setTimeout(() => setJustAdded(null), 1600);
  }, []);

  const handleCreate = useCallback((node, edge) => {
    catalog.addModel(node, edge);
    setJustAdded(node.id);
    setTimeout(() => setJustAdded(null), 1600);
  }, []);

  const [p0, p1, p2] = t.layerPalette;
  const allModels = useMemo(() => catalog.listModels(), [catalogVersion]);
  const curProjectName = (projects.find((p) => p.id === projectId) || projects[0]).name;
  const studioStyle = {
    "--primary": t.accent, "--primary-hover": t.accent, "--primary-light": `color-mix(in srgb, ${t.accent} 16%, white)`,
    "--primary-dark": `color-mix(in srgb, ${t.accent} 70%, black)`,
    "--layer-staging": p0, "--layer-staging-bg": `color-mix(in srgb, ${p0} 12%, white)`,
    "--layer-intermediate": p1, "--layer-intermediate-bg": `color-mix(in srgb, ${p1} 12%, white)`,
    "--layer-mart": p2, "--layer-mart-bg": `color-mix(in srgb, ${p2} 12%, white)`,
    "--font-serif": t.headingFont === "System" ? "var(--font-sans)" : `"${t.headingFont}", Georgia, serif`,
  };
  const isStudio = t.theme === "Studio";
  const rootStyle = isStudio ? studioStyle : {};
  const themeClass = isStudio ? (t.surface === "cool" ? " cool" : "") : ` theme-${t.theme.toLowerCase()}`;
  const darkClass = t.dark ? " dark" : "";

  return (
    <div className={"app" + (t.auditBadges ? "" : " no-ai") + themeClass + darkClass + (t.canvasGrid ? "" : " no-grid") + (route.name === "org" ? " org-open" : "")} style={rootStyle}>
      <div className="main">
        <div className="topbar">
          <div className="topbar-inner">
            <div className="breadcrumb">
              <button className={"org-badge-btn" + (route.name === "org" ? " on" : "")} onClick={toggleOrg}
                title={route.name === "org" ? "Close organization" : "Organization settings"}>
                <span className="bd-face bd-d">{catalog.getOrg().name[0]}</span>
                <span className="bd-face bd-x"><Icon name="x" size={17} /></span>
              </button>
              <div className="bc-rest">
                <span className="brand-sep">/</span>
                {route.name === "model" ? (
                  <React.Fragment>
                    <button className="crumb-link" onClick={() => setRoute({ name: "workspace" })}>{curProjectName}</button>
                    <span className="sep">/</span>
                    <ModelPicker current={route.node} models={allModels} onSelect={openModel} />
                  </React.Fragment>
                ) : (
                  <React.Fragment>
                    <ProjectPicker projectId={projectId} onSelect={(p) => { setProjectId(p.id); setRoute({ name: "workspace" }); }} />
                    {route.name === "chats" && <React.Fragment><span className="sep">/</span><span className="current">All Chats</span></React.Fragment>}
                    {route.name === "engines" && <React.Fragment><span className="sep">/</span><span className="current">Query Engines</span></React.Fragment>}
                  </React.Fragment>
                )}
              </div>
            </div>
            <div className="topbar-actions">
              <div className="icon-group nolead">
                <button className="icon-btn" title="Upload a source" onClick={() => setUpload({ open: true, source: null })}><Icon name="upload" /></button>
                <button className="icon-btn" title="Export dbt project" onClick={() => setExportOpen(true)}><Icon name="download" /></button>
                <button className="icon-btn" title="Query engines" onClick={() => setRoute({ name: "engines" })}><Icon name="database" /></button>
                <button className="icon-btn cold-btn-toolbar" title="Cold storage" onClick={() => setColdOpen(true)}>
                  <Icon name="fridge" />
                  {catalog.listColdStorage().length > 0 && <span className="cold-count">{catalog.listColdStorage().length}</span>}
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="content">
          <div className="frame">
            {route.name === "workspace" && <Workspace mode={t.lineageMode} setMode={(m) => setTweak("lineageMode", m)}
              onOpen={onOpenNode} justAdded={justAdded} />}
            {route.name === "model" && <ModelDetail node={route.node} onOpen={openModel} />}
            {route.name === "engines" && <Stub title="Query Engines" sub="DuckDB · connected. Manage compute for previews and exports." />}
            {route.name === "chats" && <AllChats go={go} />}
            {route.name === "org" && <OrgSettings dark={t.dark} onToggleDark={() => setTweak("dark", !t.dark)} />}
          </div>
        </div>
      </div>

      {!chatOpen && route.name !== "org" && (
        <button className="assistant-fab" onClick={() => setChatOpen(true)} aria-label="Assistant">
          <Icon name="sparkle" size={23} />
        </button>
      )}
      {chatOpen && <div className="ao-scrim" onClick={() => setChatOpen(false)} />}
      {chatOpen && (t.dark
        ? <TerminalAssistant context={route.name === "model" ? route.node : null}
            onCreate={handleCreate} onClose={() => setChatOpen(false)} onOpenNode={openModel} go={go} />
        : <AssistantOverlay context={route.name === "model" ? route.node : null}
            onCreate={handleCreate} onClose={() => setChatOpen(false)} onOpenNode={openModel} go={go} />
      )}
      {exportOpen && <ExportDrawer onClose={() => setExportOpen(false)} />}
      {upload.open && <UploadModal key={upload.source ? upload.source.id : "new-upload"} source={upload.source} onClose={() => setUpload({ open: false, source: null })} onCreateSource={handleCreateSource} onRename={renameSource} onArchive={(src) => setConfirmArchive(src)} />}
      {confirmArchive && <ConfirmArchive source={confirmArchive} onCancel={() => setConfirmArchive(null)} onConfirm={archiveSource} />}
      {coldOpen && <ColdStorageModal items={catalog.listColdStorage()} onRestore={restoreSource} onClose={() => setColdOpen(false)} />}

      <TweaksPanel title="Tweaks">
        <TweakSection label="Theme" />
        <TweakSelect label="Aesthetic" value={t.theme}
          options={["Studio", "Neon", "Macintosh", "Neobrutalist", "Comic"]} onChange={(v) => setTweak("theme", v)} />
        <TweakSection label="Atmosphere" />
        <TweakRadio label="Surface" value={t.surface} options={["warm", "cool"]} onChange={(v) => setTweak("surface", v)} />
        <TweakSelect label="Headings" value={t.headingFont} options={["Bricolage Grotesque", "Instrument Serif", "System"]} onChange={(v) => setTweak("headingFont", v)} />
        <TweakToggle label="Canvas grid" value={t.canvasGrid} onChange={(v) => setTweak("canvasGrid", v)} />
        <TweakSection label="Lineage" />
        <TweakRadio label="Visualization" value={t.lineageMode} options={["dag", "swimlanes", "audit"]}
          onChange={(v) => setTweak("lineageMode", v)} />
        <TweakToggle label="AI-edit badges" value={t.auditBadges} onChange={(v) => setTweak("auditBadges", v)} />
        <TweakSection label="Studio tuning" />
        <TweakColor label="Accent" value={t.accent}
          options={["#3b82f6", "#4f46e5", "#0d9488", "#db2777"]} onChange={(v) => setTweak("accent", v)} />
        <TweakColor label="Layer colors" value={t.layerPalette}
          options={[["#2563eb", "#7c3aed", "#047857"], ["#0ea5e9", "#f59e0b", "#10b981"], ["#475569", "#6366f1", "#0d9488"]]}
          onChange={(v) => setTweak("layerPalette", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
