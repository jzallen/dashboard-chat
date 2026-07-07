/* DAG view (horizontal flow): nodes laid out in layer columns, edges as Béziers.

   Layering: a thin container (DagView) reads the catalog + derives focus/in-flight
   state, then renders pure presentational Node/Edge cards from plain props. The
   leaf cards never touch the catalog or drill an open-node callback — the card
   reads it from context. Geometry stays in the React-free lineageLayout module. */
import { type CSSProperties, useMemo, useState } from "react";

import type { DataCatalog, LineageNode } from "../../catalog";
import { LayerDot } from "../primitives";
import styles from "./lineageCanvas.module.css";
import {
  bezierPath,
  computeDagLayout,
  DagDimensionConfig,
  type Point,
} from "./lineageLayout";
import { useOpenNode } from "./openNodeContext";
import { AiEditChip } from "./shared";
import { useInFlightSourceNode } from "./useInFlightSourceNode";
import { dagFocusModel, dagNodeAuditCount } from "./viewModel";

function Node({
  n,
  style,
  selected,
  orphan,
  dim,
  justAdded,
  auditEditCount,
  phaseLabel,
  onHover,
}: {
  n: LineageNode;
  style: CSSProperties;
  selected: boolean;
  orphan: boolean;
  dim: boolean;
  justAdded: boolean;
  /** AI-edit count for this node (derived by the container, not read here). */
  auditEditCount: number;
  /** The in-flight source-upload phase badge for this node, when advancing. */
  phaseLabel: string | null;
  onHover: (id: string | null) => void;
}) {
  const onOpen = useOpenNode();
  const fields = n.ref
    ? n.ref.fields?.length ||
      n.ref.columns?.length ||
      n.ref.columns_metadata?.length
    : null;
  return (
    <div
      className={`${styles.lnNode} layer-${n.layer}`}
      data-selected={selected || undefined}
      data-orphan={orphan || undefined}
      data-dim={dim || undefined}
      data-just-added={justAdded || undefined}
      data-uploading={phaseLabel ? true : undefined}
      style={style}
      onMouseEnter={() => onHover(n.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onOpen(n)}
    >
      <div className={styles.lnRow}>
        <LayerDot layer={n.layer} size={8} />
        <span className={styles.lnName}>{n.label}</span>
      </div>
      <div className={styles.lnSub}>{phaseLabel ?? n.sub}</div>
      <div className={styles.lnMeta}>
        {auditEditCount > 0 && (
          <AiEditChip count={auditEditCount} label="edits" />
        )}
        {fields ? (
          <span className={styles.fieldsChip}>{fields} cols</span>
        ) : null}
      </div>
    </div>
  );
}

function Edge({
  sourcePos,
  targetPos,
  hot,
  dim,
}: {
  sourcePos: Point | undefined;
  targetPos: Point | undefined;
  hot: boolean;
  dim: boolean;
}) {
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

export function DagView({
  catalog,
  version,
  sel,
  flashedNodeId,
}: {
  catalog: DataCatalog;
  version: number;
  sel: string | null;
  flashedNodeId: string | null;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(
    () => computeDagLayout(catalog, DagDimensionConfig),
    [catalog, version],
  );

  // The optimistic source-upload node + its phase badge, stitched from the
  // XState upload region behind one derived value (the single view-substrate seam).
  const { inFlightNodeId, inFlightLabel } = useInFlightSourceNode();

  const inFocusNodeId = hover || sel;
  const orphans = catalog.orphans();
  const focus = useMemo(
    () => dagFocusModel(catalog, inFocusNodeId),
    [catalog, version, inFocusNodeId],
  );

  return (
    <div
      className={styles.canvas}
      style={{
        width: layout.width,
        height: layout.height,
        minWidth: layout.width,
      }}
    >
      <svg className={styles.edges}>
        {catalog.listEdges().map(([sourceId, targetId], index) => (
          <Edge
            key={index}
            sourcePos={layout.nodePositions[sourceId]}
            targetPos={layout.nodePositions[targetId]}
            hot={focus.hotEdges.has(index)}
            dim={!focus.hotEdges.has(index) && !!inFocusNodeId}
          />
        ))}
      </svg>
      {catalog.listNodes().map((n) => {
        const pos = layout.nodePositions[n.id];
        if (!pos) return null;
        const nodeStyle: CSSProperties = {
          left: pos.x,
          top: pos.y,
          width: DagDimensionConfig.nodeWidth,
          height: DagDimensionConfig.nodeHeight,
        };
        return (
          <Node
            key={n.id}
            n={n}
            style={nodeStyle}
            selected={sel === n.id}
            orphan={orphans.has(n.id)}
            dim={focus.isDimmed(n.id)}
            justAdded={n.id === flashedNodeId}
            auditEditCount={dagNodeAuditCount(catalog, n.id)}
            phaseLabel={n.id === inFlightNodeId ? inFlightLabel : null}
            onHover={setHover}
          />
        );
      })}
    </div>
  );
}
