/* DAG view (horizontal flow): nodes laid out in layer columns, edges as Béziers. */
import { useMemo, useState } from "react";

import { catalog } from "../fixtureSource";
import { LayerDot } from "../primitives";
import {
  bezierPath,
  computeDagLayout,
  DagDimensionConfig,
} from "./lineageLayout";
import { AiEditChip, cx } from "./shared";

function NodeInner({ n }) {
  const auditEditCount = catalog.auditCount(n.id);
  const fields = n.ref
    ? n.ref.fields?.length ||
      n.ref.columns?.length ||
      n.ref.columns_metadata?.length
    : null;
  return (
    <>
      <div className="ln-row">
        <LayerDot layer={n.layer} size={8} />
        <span className="ln-name">{n.label}</span>
      </div>
      <div className="ln-sub">{n.sub}</div>
      <div className="ln-meta">
        {auditEditCount > 0 && (
          <AiEditChip count={auditEditCount} label="edits" />
        )}
        {fields ? <span className="fields-chip">{fields} cols</span> : null}
      </div>
    </>
  );
}

export function DagView({ version, sel, onOpen, justAdded }) {
  const [hover, setHover] = useState(null);
  const layout = useMemo(
    () => computeDagLayout(catalog, DagDimensionConfig),
    [version],
  );

  const focus = hover || sel;
  const orphans = catalog.orphans();
  const litEdges = new Set();
  if (focus) {
    catalog.listEdges().forEach(([a, b], i) => {
      if (a === focus || b === focus) litEdges.add(i);
    });
  }

  return (
    <div
      className="canvas"
      style={{ width: layout.w, height: layout.h, minWidth: layout.w }}
    >
      <svg className="edges">
        {catalog.listEdges().map(([a, b], i) => {
          const sourcePos = layout.pos[a];
          const targetPos = layout.pos[b];
          if (!sourcePos || !targetPos) return null;
          const edgeClass = litEdges.has(i)
            ? "ln-edge hot"
            : focus
              ? "ln-edge dim"
              : "ln-edge";
          return (
            <path
              key={i}
              className={edgeClass}
              d={bezierPath(sourcePos, targetPos, DagDimensionConfig)}
            />
          );
        })}
      </svg>
      {catalog.listNodes().map((n) => {
        const p = layout.pos[n.id];
        if (!p) return null;
        const nodeClass = cx(
          "ln-node",
          sel === n.id && "sel",
          orphans.has(n.id) && "orphan",
          focus && focus !== n.id && !catalog.isAdjacent(focus, n.id) && "dim",
          n.id === justAdded && "pop",
          `layer-${n.layer}`,
        );
        return (
          <div
            key={n.id}
            className={nodeClass}
            style={{
              left: p.x,
              top: p.y,
              width: DagDimensionConfig.nodeWidth,
              height: DagDimensionConfig.nodeHeight,
            }}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => onOpen(n)}
          >
            <NodeInner n={n} />
          </div>
        );
      })}
    </div>
  );
}
