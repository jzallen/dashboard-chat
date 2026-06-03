/* Model detail view — header, dependency strip, AI audit, columns, SQL */
function MatBadge({ m }) { return m ? <span className="badge neutral up">{m}</span> : null; }

function DepStrip({ node, onOpen }) {
  const parents = catalog.parentsOf(node.id);
  return (
    <div className="dep-strip">
      {parents.map((p) => (
        <React.Fragment key={p.id}>
          <div className={"dep-chip layer-" + p.layer} onClick={() => p.ref && onOpen(p)}>
            <LayerDot layer={p.layer} size={7} />{p.label}
          </div>
        </React.Fragment>
      ))}
      {parents.length > 0 && <Icon name="arrow" size={16} style={{ color: "var(--text-400)" }} />}
      <div className={"dep-chip here layer-" + node.layer}>
        <LayerDot layer={node.layer} size={7} />{node.label}
      </div>
    </div>
  );
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="copy-btn" onClick={() => { navigator.clipboard?.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); }}>
      <Icon name={done ? "check" : "table"} size={12} />{done ? "Copied" : "Copy"}
    </button>
  );
}

function AuditPanel({ node }) {
  const m = node.ref;
  const audit = catalog.auditFor(node.id);
  // map transform before/after samples onto matching audit lines for datasets
  const samples = (m.transforms || []).map((t) => t.sample);
  return (
    <div className="panel audit">
      <div className="panel-hd">
        <span className="ai-mark"><Icon name="sparkle" /></span>
        <span className="pt">Assistant changes</span>
        <span className="pcount">{audit.length} edits</span>
      </div>
      <div className="audit-note"><Icon name="chat" size={13} style={{ color: "var(--text-400)" }} />Generated from chat — review before exporting to dbt.</div>
      <div className="panel-body">
        {audit.map((a, i) => (
          <div className="aud-item" key={i}>
            <span className="aud-ico"><Icon name={TAG_ICON[a.tag] || TAG_ICON.default} /></span>
            <div style={{ flex: 1 }}>
              <div className="aud-say">{a.say}</div>
              {m.kind === "dataset" && samples[i] && (
                <div className="ba"><span className="b">{String(samples[i].before)}</span>
                  <span className="ar">→</span><span className="a">{String(samples[i].after)}</span></div>
              )}
            </div>
            <span className="aud-tag">{a.tag}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnsPanel({ node }) {
  const m = node.ref;
  let head, rows;
  if (m.kind === "dataset") {
    head = ["Field", "Type"];
    rows = m.fields.map((f) => [<span className="cn">{f.name}</span>, <span className={"badge " + (f.type === "number" ? "number" : "text")}>{f.type}</span>]);
  } else if (m.kind === "view") {
    head = ["Column", "Type", "Role", "Source"];
    rows = m.columns.map((c) => [<span className="cn">{c.name}</span>,
      <span className={"badge " + (["integer", "decimal"].includes(c.display_type) ? "number" : "text")}>{c.display_type}</span>,
      c.grain_role ? <span className={"role " + c.grain_role.toLowerCase()}>{c.grain_role}</span> : "—",
      <span className="expr">{c.source_ref}.{c.source_column}</span>]);
  } else {
    head = ["Column", "Role", "Type", "Expression"];
    rows = m.columns_metadata.map((c) => [<span className="cn">{c.name}</span>,
      <span className={"role " + c.semantic_role}>{c.semantic_role}</span>,
      <span className="expr">{c.semantic_type}{c.time_granularity ? ` · ${c.time_granularity}` : ""}</span>,
      c.expr ? <span className="expr">{c.expr}</span> : "—"]);
  }
  return (
    <div className="panel">
      <div className="panel-hd"><Icon name="table" size={15} style={{ color: "var(--text-500)" }} /><span className="pt">Columns</span><span className="pcount">{rows.length}</span></div>
      <table className="cols-table">
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function SummaryRow({ node }) {
  const m = node.ref;
  const kvs = [];
  if (m.kind === "view") {
    kvs.push(["joins", m.joins.length], ["filters", m.filters.length],
      ["grain", m.grain ? m.grain.time_column : "—"], ["sources", m.source_refs.length]);
  } else if (m.kind === "report") {
    const meas = m.columns_metadata.filter((c) => c.semantic_role === "measure").length;
    kvs.push(["type", m.report_type], ["measures", meas], ["domain", m.domain], ["rows", m.rows.toLocaleString()]);
  } else {
    kvs.push(["rows", m.rows.toLocaleString()], ["fields", m.fields.length], ["transforms", m.transforms.length]);
  }
  return <div className="summary-row">{kvs.map(([k, v], i) => <span className="kv" key={i}>{k} <b>{v}</b></span>)}</div>;
}

function fmtCell(v) {
  if (v === null || v === undefined || v === "") return <span style={{ color: "var(--text-400)" }}>—</span>;
  if (typeof v === "number") return <span className="mono">{v.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>;
  return String(v);
}
function DataPreview({ node }) {
  const m = node.ref;
  const cols = m.kind === "dataset" ? m.fields.map((f) => f.name)
    : m.kind === "view" ? m.columns.map((c) => c.name)
      : m.columns_metadata.map((c) => c.name);
  const rows = m.preview || [];
  if (rows.length === 0) return null;
  return (
    <div className="panel spanfull">
      <div className="sql-bar"><Icon name="grid" size={14} style={{ color: "var(--text-500)" }} /><span className="st">Data preview</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-400)" }}>{rows.length} of {m.rows.toLocaleString()} rows</span></div>
      <div className="prev-wrap">
        <table className="prev-table">
          <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{fmtCell(r[c])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

function ModelDetail({ node, onOpen }) {
  const m = node.ref;
  useCatalog(); // subscribe: re-render when the catalog mutates
  return (
    <div className={"det layer-" + node.layer}>
      <div className="det-hd">
        <div>
          <div className="det-name">{node.label}</div>
          <div className="det-friendly">{m.name}</div>
        </div>
        <div className="det-badges">
          <LayerBadge layer={node.layer} />
          {m.kind === "report" && <MatBadge m={m.report_type} />}
          <MatBadge m={m.materialization} />
        </div>
      </div>
      <DepStrip node={node} onOpen={onOpen} />
      <SummaryRow node={node} />
      <div className="det-grid" style={{ marginTop: 16 }}>
        <DataPreview node={node} />
        <AuditPanel node={node} />
        <ColumnsPanel node={node} />
        <div className="panel spanfull">
          <div className="sql-bar"><Icon name="database" size={14} style={{ color: "var(--text-500)" }} /><span className="st">Compiled SQL</span><CopyBtn text={m.sql} /></div>
          <SqlBlock sql={m.sql} />
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ModelDetail, MatBadge });
