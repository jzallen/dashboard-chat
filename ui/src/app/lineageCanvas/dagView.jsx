/* DAG view (horizontal flow): nodes laid out in layer columns, edges as Béziers. */
import { useMemo, useState } from "react";

import { catalog } from "../fixtureSource";
import { LayerDot } from "../primitives";
import {
  bezierPath,
  computeDagLayout,
  DagDimensionConfig,
} from "./lineageLayout";
import styles from "./lineageCanvas.module.css";
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
      <div className={styles.lnRow}>
        <LayerDot layer={n.layer} size={8} />
        <span className={styles.lnName}>{n.label}</span>
      </div>
      <div className={styles.lnSub}>{n.sub}</div>
      <div className={styles.lnMeta}>
        {auditEditCount > 0 && (
          <AiEditChip count={auditEditCount} label="edits" />
        )}
        {fields ? (
          <span className={styles.fieldsChip}>{fields} cols</span>
        ) : null}
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
      className={styles.canvas}
      style={{ width: layout.w, height: layout.h, minWidth: layout.w }}
    >
      <svg className={styles.edges}>
        {catalog.listEdges().map(([a, b], i) => {
          const sourcePos = layout.pos[a];
          const targetPos = layout.pos[b];
          if (!sourcePos || !targetPos) return null;
          const edgeClass = cx(
            styles.lnEdge,
            litEdges.has(i) && styles.hot,
            !litEdges.has(i) && focus && styles.dim,
          );
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
          styles.lnNode,
          sel === n.id && styles.sel,
          orphans.has(n.id) && styles.orphan,
          focus &&
            focus !== n.id &&
            !catalog.isAdjacent(focus, n.id) &&
            styles.dim,
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
