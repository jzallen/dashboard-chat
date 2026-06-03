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
import { AiEditChip } from "./shared";

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

function Edge({ sourcePos, targetPos, hot, dim }) {
  if (!sourcePos || !targetPos) return null;
  return (
    <path
      className={styles.lnEdge}
      data-hot={hot || undefined}
      data-dim={dim || undefined}
      d={bezierPath(sourcePos, targetPos, DagDimensionConfig)}
    />
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
    catalog.listEdges().forEach(([sourceId, targetId], index) => {
      if (sourceId === focus || targetId === focus) litEdges.add(index);
    });
  }

  return (
    <div
      className={styles.canvas}
      style={{ width: layout.w, height: layout.h, minWidth: layout.w }}
    >
      <svg className={styles.edges}>
        {catalog.listEdges().map(([sourceId, targetId], index) => (
          <Edge
            key={index}
            sourcePos={layout.pos[sourceId]}
            targetPos={layout.pos[targetId]}
            hot={litEdges.has(index)}
            dim={!litEdges.has(index) && !!focus}
          />
        ))}
      </svg>
      {catalog.listNodes().map((n) => {
        const p = layout.pos[n.id];
        if (!p) return null;
        return (
          <div
            key={n.id}
            className={`${styles.lnNode} layer-${n.layer}`}
            data-selected={sel === n.id || undefined}
            data-orphan={orphans.has(n.id) || undefined}
            data-dim={
              (focus && focus !== n.id && !catalog.isAdjacent(focus, n.id)) ||
              undefined
            }
            data-just-added={n.id === justAdded || undefined}
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
