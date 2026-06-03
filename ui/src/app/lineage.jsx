/* Lineage canvas with 3 visualization styles: dag · swimlanes · audit-stream.
   Pure layout logic lives in src/lib/graph.ts (LAYER_ORDER, STREAM_LAYERS, DAG,
   nodesInLayer, orphanSet, isAdjacent, computeDagLayout, bezierPath); the data
   projection (lineageGraph, auditCount, auditFor) comes off the `catalog` —
   all bridged in as globals. This file is the presentational layer: views,
   chips, and the layer→CSS-vars / tag→icon maps. */

/** Join class-name parts, dropping falsy ones, into a single space-separated string. */
function cx(...parts) {
  return parts.filter(Boolean).join(" ");
}

/** Inline CSS custom properties (layer color + soft bg) for a pipeline layer. */
function layerVars(layer) {
  const layerMeta = LAYER_META[layer] || {};
  return { "--ln": layerMeta.color, "--ln-soft": layerMeta.bg };
}

/** Sparkle chip showing an AI-edit count, with an optional trailing label. */
function AiEditChip({ count, label, style }) {
  return (
    <span className="ai-chip" style={style}>
      <Icon name="sparkle" />
      {count}{label ? ` ${label}` : ""}
    </span>
  );
}

function NodeInner({ n }) {
  const auditEditCount = catalog.auditCount(n.id);
  const fields = n.ref ? (n.ref.fields?.length || n.ref.columns?.length || n.ref.columns_metadata?.length) : null;
  return (
    <React.Fragment>
      <div className="ln-row">
        <LayerDot layer={n.layer} size={8} />
        <span className="ln-name">{n.label}</span>
      </div>
      <div className="ln-sub">{n.sub}</div>
      <div className="ln-meta">
        {auditEditCount > 0 && <AiEditChip count={auditEditCount} label="edits" />}
        {fields ? <span className="fields-chip">{fields} cols</span> : null}
      </div>
    </React.Fragment>
  );
}

/* ---------- DAG (horizontal flow) ---------- */
function DagView({ graph, sel, onOpen, justAdded }) {
  const [hover, setHover] = useState(null);
  const layout = useMemo(() => computeDagLayout(graph, DAG), [graph]);

  const focus = hover || sel;
  const orphans = orphanSet(graph);
  const litEdges = new Set();
  if (focus) {
    graph.edges.forEach(([a, b], i) => {
      if (a === focus || b === focus) litEdges.add(i);
    });
  }

  return (
    <div className="canvas" style={{ width: layout.w, height: layout.h, minWidth: layout.w }}>
      <svg className="edges">
        {graph.edges.map(([a, b], i) => {
          const sourcePos = layout.pos[a];
          const targetPos = layout.pos[b];
          if (!sourcePos || !targetPos) return null;
          const edgeClass = litEdges.has(i) ? "ln-edge hot" : focus ? "ln-edge dim" : "ln-edge";
          return <path key={i} className={edgeClass} d={bezierPath(sourcePos, targetPos, DAG)} />;
        })}
      </svg>
      {Object.values(graph.nodes).map((n) => {
        const p = layout.pos[n.id];
        if (!p) return null;
        const nodeClass = cx(
          "ln-node",
          sel === n.id && "sel",
          orphans.has(n.id) && "orphan",
          focus && focus !== n.id && !isAdjacent(graph, focus, n.id) && "dim",
          n.id === justAdded && "pop",
        );
        return (
          <div key={n.id} className={nodeClass}
            style={{ left: p.x, top: p.y, width: DAG.NW, height: DAG.NH, ...layerVars(n.layer) }}
            onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)}
            onClick={() => onOpen(n)}>
            <NodeInner n={n} />
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Swimlanes (layer bands) ---------- */
function SwimView({ graph, sel, onOpen, justAdded }) {
  const parentsOf = (id) => graph.edges.filter(([, b]) => b === id).map(([a]) => graph.nodes[a]?.label).filter(Boolean);
  const orphans = orphanSet(graph);
  return (
    <div className="lanes">
      {LAYER_ORDER.map((ly) => {
        const layerMeta = LAYER_META[ly];
        const items = nodesInLayer(graph, ly);
        return (
          <div className="lane" key={ly} style={layerVars(ly)}>
            <div className="lane-head">
              <LayerDot layer={ly} />
              <span className="lh-name">{layerMeta.name}</span>
              <span className="lh-dbt">{layerMeta.dbt}</span>
              <span className="lh-desc">{layerMeta.desc}</span>
            </div>
            <div className="lane-body">
              {items.map((n) => {
                const parentLabels = parentsOf(n.id);
                const edits = catalog.auditCount(n.id);
                return (
                  <div key={n.id} className={cx("lane-card", sel === n.id && "sel", orphans.has(n.id) && "orphan", n.id === justAdded && "pop")}
                    style={layerVars(ly)} onClick={() => onOpen(n)}>
                    <div className="ln-row"><span className="ln-name">{n.label}</span></div>
                    <div className="ln-sub">{n.sub}</div>
                    <div className="ln-meta">
                      {orphans.has(n.id) && <span className="orphan-tag"><Icon name="x" size={10} />Orphaned</span>}
                      {edits > 0 && <AiEditChip count={edits} />}
                    </div>
                    {parentLabels.length > 0 && <div className="lane-src"><Icon name="arrow" size={12} />{parentLabels.join(" · ")}</div>}
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
  return (
    <div className="stream">
      {STREAM_LAYERS.map((ly) => {
        const layerMeta = LAYER_META[ly];
        const items = nodesInLayer(graph, ly);
        return (
          <div className="stream-group" key={ly} style={layerVars(ly)}>
            <div className="stream-rail" />
            <div className="stream-dot" />
            <div className="stream-layer"><LayerDot layer={ly} />{layerMeta.name}<span className="stream-dbt">{layerMeta.dbt}</span></div>
            {items.map((n) => {
              const audit = catalog.auditFor(n.id) || (n.audit || []);
              return (
                <div key={n.id} className={cx("stream-card", sel === n.id && "sel", n.id === justAdded && "pop")}
                  style={layerVars(ly)} onClick={() => n.ref && onOpen(n)}>
                  <div className="sc-head">
                    <span className="sc-name">{n.label} <span className="lite">· {n.sub}</span></span>
                    <AiEditChip count={audit.length} label="AI edits" style={{ marginLeft: "auto" }} />
                  </div>
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
  const graph = useMemo(() => catalog.lineageGraph({ extraNodes, extraEdges, archived, nameOverrides }), [extraNodes, extraEdges, archived, nameOverrides]);
  return (
    <div className="lin-scroll" style={{ overflowX: "auto" }}>
      {mode === "dag" && <DagView graph={graph} sel={sel} onOpen={onOpen} justAdded={justAdded} />}
      {mode === "swimlanes" && <SwimView graph={graph} sel={sel} onOpen={onOpen} justAdded={justAdded} />}
      {mode === "audit" && <StreamView graph={graph} sel={sel} onOpen={onOpen} justAdded={justAdded} />}
    </div>
  );
}

Object.assign(window, { LineageCanvas, layerVars, TAG_ICON });
