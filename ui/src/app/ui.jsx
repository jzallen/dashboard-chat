/* UI primitives — match the real app shell (sidebar, topbar, breadcrumb, badges) */
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ---- icon set (stroke, 18px, matching the app's line icons) ---- */
const ICON = {
  plus: "M12 5v14M5 12h14",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  engine: "M4 7h16M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2M4 7v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7M8 11h.01M8 15h.01",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-5A8 8 0 1 1 21 12z",
  download: "M12 3v12m0 0 4-4m-4 4-4-4M5 21h14",
  database: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  clock: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1-2.7H2a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 4 6.6l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V2a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H22a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
  refresh: "M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  table: "M3 5h18v14H3zM3 10h18M9 10v9M3 14h18",
  chevL: "M15 6l-6 6 6 6",
  chevR: "M9 6l6 6-6 6",
  chevD: "M6 9l6 6 6-6",
  x: "M6 6l12 12M18 6L6 18",
  sparkle: "M12 3l1.8 4.7L18 9.5l-4.2 1.8L12 16l-1.8-4.7L6 9.5l4.2-1.8z",
  flow: "M4 7h6M14 7h6M4 17h6M14 17h6M10 7a2 2 0 1 0 4 0 2 2 0 1 0-4 0M10 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0",
  layers: "M12 3l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5",
  check: "M5 12l5 5L20 7",
  arrow: "M5 12h14m0 0-5-5m5 5-5 5",
  send: "M4 12l16-7-7 16-2-7-7-2z",
  join: "M9 5a4 4 0 1 0 0 8M15 5a4 4 0 1 1 0 8M9 9h6",
  filter: "M4 5h16l-6 7v6l-4-2v-4z",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
  upload: "M12 16V4M8 8l4-4 4 4M5 20h14",
  file: "M14 3v5h5M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z",
  fridge: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM6 9.5h12M9.2 6v1.6M9.2 12v2.4",
  snow: "M12 2v20M3.34 7l17.32 10M20.66 7L3.34 17M12 5l2-1.2M12 5l-2-1.2M12 19l2 1.2M12 19l-2 1.2M5.2 8.4l-2.3-.2M5.2 8.4l.2-2.3M18.8 15.6l2.3.2M18.8 15.6l-.2 2.3M18.8 8.4l2.3-.2M18.8 8.4l-.2-2.3M5.2 15.6l-2.3.2M5.2 15.6l.2 2.3",
  donut: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  egg: "M12 3c-3.3 0-6 4.6-6 9a6 6 0 0 0 12 0c0-4.4-2.7-9-6-9z",
  pickles: "M7 8h10v11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2zM9 8V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M10.5 12v5M13.5 12v5",
  icecream: "M7.5 9.5a4.5 4.5 0 0 1 9 0zM7 9.5h10l-5 11z",
  cookie: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9 9h.01M14.5 8h.01M15 13h.01M10 15h.01M12 11h.01",
  pizza: "M12 3 3.4 18.6a1 1 0 0 0 .9 1.5l15.4-.4a1 1 0 0 0 .9-1.4zM10 9h.01M14 11h.01M11 14h.01",
};
function Icon({ name, size = 18, style }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={ICON[name]} />
    </svg>
  );
}

function LayerDot({ layer, size = 9 }) {
  const c = DC.LAYERS[layer]?.color || "var(--muted)";
  return <span style={{ width: size, height: size, borderRadius: 99, background: c, flex: `0 0 ${size}px`, display: "inline-block" }} />;
}
function LayerBadge({ layer }) {
  const L = DC.LAYERS[layer]; if (!L) return null;
  return (
    <span className="badge" style={{ background: L.bg, color: L.color }}>
      <LayerDot layer={layer} size={7} />{L.name}
    </span>
  );
}

/* ---- Sidebar (matches screenshots) ---- */
function Sidebar({ route, go, collapsed, onToggle }) {
  const items = [
    { key: "new", icon: "plus", label: "New Session", accent: true },
    { key: "projects", icon: "folder", label: "Projects" },
    { key: "engines", icon: "engine", label: "Query Engines" },
    { key: "chats", icon: "chat", label: "All Chats" },
  ];
  const activeNav = route.name === "workspace" || route.name === "model" || route.name === "lineage" ? "projects" : route.name === "chat" ? "new" : route.name;
  return (
    <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
      <div className="sidebar-top">
        <span className="org-name">Demo Org</span>
        <button className="icon-btn" style={{ width: 30, height: 30 }} onClick={onToggle} title="Collapse">
          <Icon name="chevL" size={15} />
        </button>
      </div>
      <nav className="nav">
        {items.map((it) => (
          <button key={it.key} className={"nav-item" + (activeNav === it.key ? " active" : "") + (it.accent ? " accent" : "")}
            onClick={() => go(it.key === "projects" ? { name: "workspace" } : it.key === "new" ? { name: "chat" } : { name: it.key })}>
            <Icon name={it.icon} size={16} />{it.label}
          </button>
        ))}
      </nav>
      <div className="nav-label">Recent</div>
      <div className="recent">
        {DC.RECENTS.map((r, i) => (
          <button key={i} className="recent-item" onClick={() => go({ name: "openRecent", nodeId: r.nodeId })}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</span>
            <span className="when">now</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

/* ---- Breadcrumb + TopBar ---- */
function Breadcrumb({ crumbs }) {
  return (
    <div className="breadcrumb">
      {crumbs.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="sep">/</span>}
          {i === 0 && <span className="sep">/</span>}
          {c.onClick ? <span className="crumb" onClick={c.onClick}>{c.label}</span>
            : <span className="current">{c.label}</span>}
        </React.Fragment>
      ))}
    </div>
  );
}

function TopBar({ crumbs, children }) {
  return (
    <div className="topbar">
      <Breadcrumb crumbs={crumbs} />
      <div className="topbar-actions">{children}</div>
    </div>
  );
}

function StatusChip() {
  const [m, setM] = useState(0);
  useEffect(() => { const t = setInterval(() => setM((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  return <div className="status-chip">Idle: {m}m</div>;
}

/* ---- SQL syntax highlighter ---- */
const SQL_KW = /\b(SELECT|FROM|INNER|LEFT|RIGHT|JOIN|ON|WHERE|GROUP BY|ORDER BY|AS|AND|OR|SUM|COUNT|DISTINCT|COALESCE|LOWER|UPPER|INITCAP|TRIM|CAST|DATE_TRUNC|MAX|MIN)\b/g;
function SqlBlock({ sql, dense }) {
  // tokenize: refs {{ ref('x') }}, strings '...', keywords, comments
  const html = useMemo(() => {
    let s = sql.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    s = s.replace(/(\{\{\s*ref\([^}]*\)\s*\}\})/g, '<span class="sql-ref">$1</span>');
    s = s.replace(/('[^']*')/g, '<span class="sql-str">$1</span>');
    s = s.replace(SQL_KW, '<span class="sql-kw">$1</span>');
    return s;
  }, [sql]);
  return <pre className={"sql-block" + (dense ? " dense" : "")}><code dangerouslySetInnerHTML={{ __html: html }} /></pre>;
}

Object.assign(window, { Icon, ICON, LayerDot, LayerBadge, Sidebar, Breadcrumb, TopBar, StatusChip, SqlBlock,
  useState, useEffect, useRef, useMemo, useCallback });
