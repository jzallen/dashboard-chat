/* Lineage canvas with 3 visualization styles: dag · swimlanes · audit-stream */
const LAYER_ORDER = ["source", "staging", "intermediate", "mart"];

function buildGraph(extraNodes, extraEdges, archived, nameOverrides) {
  const base = { ...DC.NODES };
  (extraNodes || []).forEach((n) => { base[n.id] = n; });
  const arch = new Set(archived || []);
  const ov = nameOverrides || {};
  const nodes = {};
  Object.values(base).forEach((n) => {
    if (arch.has(n.id)) return;
    nodes[n.id] = ov[n.id] ? { ...n, label: ov[n.id] } : n;
  });
  const edges = [...DC.EDGES, ...(extraEdges || [])].filter(([a, b]) => !arch.has(a) && !arch.has(b));
  return { nodes, edges };
}
function auditCount(id) { return (DC.AUDIT[id] || []).length; }
function orphanSet(graph) {
  const hasIncoming = new Set(graph.edges.map(([, b]) => b));
  const s = new Set();
  Object.values(graph.nodes).forEach((n) => { if (n.layer !== "source" && !hasIncoming.has(n.id)) s.add(n.id); });
  return s;
}
function layerVars(layer) {
  const L = DC.LAYERS[layer] || {};
  return { "--ln": L.color, "--ln-soft": L.bg };
}

function NodeInner({ n }) {
  const cnt = auditCount(n.id);
  const fields = n.ref ? (n.ref.fields?.length || n.ref.columns?.length || n.ref.columns_metadata?.length) : null;
  return (
    <React.Fragment>
      <div className="ln-row"><LayerDot layer={n.layer} size={8} /><span className="ln-name">{n.label}</span></div>
      <div className="ln-sub">{n.sub}</div>
      <div className="ln-meta">
        {cnt > 0 && <span className="ai-chip"><Icon name="sparkle" />{cnt} edits</span>}
        {fields ? <span className="fields-chip">{fields} cols</span> : null}
      </div>
    </React.Fragment>
  );
}

/* ---------- DAG (horizontal flow) ---------- */
function DagView({ graph, sel, onOpen, justAdded }) {
  const [hover, setHover] = useState(null);
  const NW = 186, NH = 96, COLGAP = 54, ROWGAP = 28, PADX = 16, PADY = 16;
  const layout = useMemo(() => {
    const cols = LAYER_ORDER.map((ly) => Object.values(graph.nodes).filter((n) => n.layer === ly));
    const maxRows = Math.max(...cols.map((c) => c.length), 1);
    const contentH = maxRows * (NH + ROWGAP) - ROWGAP;
    const pos = {};
    cols.forEach((col, c) => {
      const stackH = col.length * (NH + ROWGAP) - ROWGAP;
      const startY = PADY + (contentH - stackH) / 2;
      col.forEach((n, r) => { pos[n.id] = { x: PADX + c * (NW + COLGAP), y: startY + r * (NH + ROWGAP) }; });
    });
    return { pos, w: PADX * 2 + 4 * (NW + COLGAP) - COLGAP, h: PADY * 2 + contentH };
  }, [graph]);

  const focus = hover || sel;
  const orphans = orphanSet(graph);
  const litEdges = new Set();
  if (focus) graph.edges.forEach(([a, b], i) => { if (a === focus || b === focus) litEdges.add(i); });

  return (
    <div className="canvas" style={{ width: layout.w, height: layout.h, minWidth: layout.w }}>
      <svg className="edges">
        {graph.edges.map(([a, b], i) => {
          const pa = layout.pos[a], pb = layout.pos[b]; if (!pa || !pb) return null;
          const x1 = pa.x + NW, y1 = pa.y + NH / 2, x2 = pb.x, y2 = pb.y + NH / 2;
          const mx = (x1 + x2) / 2;
          const cls = litEdges.has(i) ? "ln-edge hot" : focus ? "ln-edge dim" : "ln-edge";
          return <path key={i} className={cls} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} />;
        })}
      </svg>
      {Object.values(graph.nodes).map((n) => {
        const p = layout.pos[n.id]; if (!p) return null;
        const cls = "ln-node" + (sel === n.id ? " sel" : "") + (orphans.has(n.id) ? " orphan" : "") + (focus && focus !== n.id && !isAdjacent(graph, focus, n.id) ? " dim" : "");
        return (
          <div key={n.id} className={cls + (n.id === justAdded ? " pop" : "")}
            style={{ left: p.x, top: p.y, width: NW, height: NH, ...layerVars(n.layer) }}
            onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
            onClick={() => onOpen(n)}>
            <NodeInner n={n} />
          </div>
        );
      })}
    </div>
  );
}
function isAdjacent(graph, focus, id) {
  return graph.edges.some(([a, b]) => (a === focus && b === id) || (b === focus && a === id));
}

/* ---------- Swimlanes (layer bands) ---------- */
function SwimView({ graph, sel, onOpen, justAdded }) {
  const parentsOf = (id) => graph.edges.filter(([, b]) => b === id).map(([a]) => graph.nodes[a]?.label).filter(Boolean);
  const orphans = orphanSet(graph);
  return (
    <div className="lanes">
      {LAYER_ORDER.map((ly) => {
        const L = DC.LAYERS[ly];
        const items = Object.values(graph.nodes).filter((n) => n.layer === ly);
        return (
          <div className="lane" key={ly} style={layerVars(ly)}>
            <div className="lane-head"><LayerDot layer={ly} /><span className="lh-name">{L.name}</span>
              <span className="lh-dbt">{L.dbt}</span><span className="lh-desc">{L.desc}</span></div>
            <div className="lane-body">
              {items.map((n) => {
                const par = parentsOf(n.id);
                return (
                  <div key={n.id} className={"lane-card" + (sel === n.id ? " sel" : "") + (orphans.has(n.id) ? " orphan" : "") + (n.id === justAdded ? " pop" : "")}
                    style={layerVars(ly)} onClick={() => onOpen(n)}>
                    <div className="ln-row"><span className="ln-name">{n.label}</span></div>
                    <div className="ln-sub">{n.sub}</div>
                    <div className="ln-meta">
                      {orphans.has(n.id) && <span className="orphan-tag"><Icon name="x" size={10} />Orphaned</span>}
                      {auditCount(n.id) > 0 && <span className="ai-chip"><Icon name="sparkle" />{auditCount(n.id)}</span>}
                    </div>
                    {par.length > 0 && <div className="lane-src"><Icon name="arrow" size={12} />{par.join(" · ")}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Audit stream (lineage + what the AI did, inline) ---------- */
const TAG_ICON = { create: "plus", join: "join", filter: "filter", grain: "clock", measure: "sparkle",
  config: "gear", clean: "check", fix: "check", cast: "refresh", shape: "table", source: "database", default: "sparkle" };
function StreamView({ graph, sel, onOpen, justAdded }) {
  const order = ["staging", "intermediate", "mart"];
  return (
    <div className="stream">
      {order.map((ly) => {
        const L = DC.LAYERS[ly];
        const items = Object.values(graph.nodes).filter((n) => n.layer === ly);
        return (
          <div className="stream-group" key={ly} style={layerVars(ly)}>
            <div className="stream-rail" />
            <div className="stream-dot" />
            <div className="stream-layer"><LayerDot layer={ly} />{L.name}<span className="stream-dbt">{L.dbt}</span></div>
            {items.map((n) => {
              const audit = DC.AUDIT[n.id] || (n.audit || []);
              return (
                <div key={n.id} className={"stream-card" + (sel === n.id ? " sel" : "") + (n.id === justAdded ? " pop" : "")}
                  style={layerVars(ly)} onClick={() => n.ref && onOpen(n)}>
                  <div className="sc-head"><span className="sc-name">{n.label} <span className="lite">· {n.sub}</span></span>
                    <span style={{ marginLeft: "auto" }} className="ai-chip"><Icon name="sparkle" />{audit.length} AI edits</span></div>
                  <div className="sc-audit">
                    {audit.length === 0 && <div className="empty-src">Raw upload — no transforms.</div>}
                    {audit.map((a, i) => (
                      <div className="audit-line" key={i}>
                        <span className="ico"><Icon name={TAG_ICON[a.tag] || TAG_ICON.default} /></span>
                        <span>{a.say}</span><span className="tag">{a.tag}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function LineageCanvas({ mode, onOpen, sel, extraNodes, extraEdges, justAdded, archived, nameOverrides }) {
  const graph = useMemo(() => buildGraph(extraNodes, extraEdges, archived, nameOverrides), [extraNodes, extraEdges, archived, nameOverrides]);
  return (
    <div className="lin-scroll" style={{ overflowX: "auto" }}>
      {mode === "dag" && <DagView graph={graph} sel={sel} onOpen={onOpen} justAdded={justAdded} />}
      {mode === "swimlanes" && <SwimView graph={graph} sel={sel} onOpen={onOpen} justAdded={justAdded} />}
      {mode === "audit" && <StreamView graph={graph} sel={sel} onOpen={onOpen} justAdded={justAdded} />}
    </div>
  );
}

Object.assign(window, { LineageCanvas, layerVars, TAG_ICON, buildGraph, auditCount, LAYER_ORDER });
