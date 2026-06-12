/* DAG view (horizontal flow): nodes laid out in layer columns, edges as Béziers. */
import { type CSSProperties, useMemo, useState } from "react";

import type { LineageNode } from "../../catalog";
import { LayerDot } from "../primitives";
import { catalog } from "../useCatalog";
import styles from "./lineageCanvas.module.css";
import {
  bezierPath,
  computeDagLayout,
  DagDimensionConfig,
  type Point,
} from "./lineageLayout";
import { AiEditChip } from "./shared";
import {
  isInFlightPhase,
  sourceUploadPhaseLabel,
  useSourceUpload,
} from "./sourceUploadPhase";

function Node({
  n,
  style,
  selected,
  orphan,
  dim,
  justAdded,
  phaseLabel,
  onHover,
  onOpen,
}: {
  n: LineageNode;
  style: CSSProperties;
  selected: boolean;
  orphan: boolean;
  dim: boolean;
  justAdded: boolean;
  /** The in-flight source-upload phase badge for this node, when advancing. */
  phaseLabel: string | null;
  onHover: (id: string | null) => void;
  onOpen: (node: LineageNode) => void;
}) {
  const auditEditCount = catalog.auditCount(n.id);
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
  version,
  sel,
  onOpen,
  flashedNodeId,
}: {
  version: number;
  sel: string | null;
  onOpen: (node: LineageNode) => void;
  flashedNodeId: string | null;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const layout = useMemo(
    () => computeDagLayout(catalog, DagDimensionConfig),
    [version],
  );

  // The optimistic source-upload node + its current phase (client-reported,
  // slice 4). The in-flight node is the saga's `source_id` once created, else
  // the optimistic `temp_node_id`; its badge shows the saga progress.
  const sourceUpload = useSourceUpload();
  const inFlightNodeId = isInFlightPhase(sourceUpload.phase)
    ? sourceUpload.source_id ?? sourceUpload.temp_node_id
    : null;
  const inFlightLabel = sourceUploadPhaseLabel(sourceUpload.phase);

  const inFocusNodeId = hover || sel;
  const orphans = catalog.orphans();
  const inFocusEdges = new Set<number>();
  if (inFocusNodeId) {
    catalog.listEdges().forEach((edge, index) => {
      if (catalog.isEdgeAdjacent(edge, inFocusNodeId)) inFocusEdges.add(index);
    });
  }

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
            hot={inFocusEdges.has(index)}
            dim={!inFocusEdges.has(index) && !!inFocusNodeId}
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
        const selected = sel === n.id;
        const orphan = orphans.has(n.id);
        const dim =
          !!inFocusNodeId &&
          inFocusNodeId !== n.id &&
          !catalog.isNodeAdjacent(inFocusNodeId, n.id);
        return (
          <Node
            key={n.id}
            n={n}
            style={nodeStyle}
            selected={selected}
            orphan={orphan}
            dim={dim}
            justAdded={n.id === flashedNodeId}
            phaseLabel={n.id === inFlightNodeId ? inFlightLabel : null}
            onHover={setHover}
            onOpen={onOpen}
          />
        );
      })}
    </div>
  );
}
