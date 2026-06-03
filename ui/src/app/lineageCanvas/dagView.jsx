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

function Node({
  node,
  pos,
  selected,
  orphan,
  dim,
  justAdded,
  onHover,
  onOpen,
}) {
  if (!pos) return null;
  return (
    <div
      className={`${styles.lnNode} layer-${node.layer}`}
      data-selected={selected || undefined}
      data-orphan={orphan || undefined}
      data-dim={dim || undefined}
      data-just-added={justAdded || undefined}
      style={{
        left: pos.x,
        top: pos.y,
        width: DagDimensionConfig.nodeWidth,
        height: DagDimensionConfig.nodeHeight,
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onOpen(node)}
    >
      <NodeInner n={node} />
    </div>
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

  const inFocusNodeId = hover || sel;
  const orphans = catalog.orphans();
  const inFocusEdges = new Set();
  if (inFocusNodeId) {
    catalog.listEdges().forEach((edge, index) => {
      if (catalog.isEdgeAdjacent(edge, inFocusNodeId)) inFocusEdges.add(index);
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
            hot={inFocusEdges.has(index)}
            dim={!inFocusEdges.has(index) && !!inFocusNodeId}
          />
        ))}
      </svg>
      {catalog.listNodes().map((n) => (
        <Node
          key={n.id}
          node={n}
          pos={layout.pos[n.id]}
          selected={sel === n.id}
          orphan={orphans.has(n.id)}
          dim={
            !!inFocusNodeId &&
            inFocusNodeId !== n.id &&
            !catalog.isNodeAdjacent(inFocusNodeId, n.id)
          }
          justAdded={n.id === justAdded}
          onHover={setHover}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
