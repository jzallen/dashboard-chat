// AuditView — lineage stream inlining the per-model audit (MR-2).
//
// Renders the lineage as a vertical stream (one row per node, upstream→downstream
// order) inlining a per-model audit section. For MR-2 the audit section surfaces
// the derived dependency summary (which upstream models feed each node); the rich
// Assistant-changes provenance panel is MR-5. Orphan nodes are flagged in-stream.
import clsx from "clsx";
import type { CSSProperties } from "react";

import type { LineageGraph, LineageLayer, LineageNode } from "../../../core/lineage/buildGraph";
import styles from "./Pipeline.module.css";

export interface AuditViewProps {
  graph: LineageGraph;
}

const LAYER_ORDER: readonly LineageLayer[] = ["source", "staging", "intermediate", "mart"];
const LAYER_RANK = new Map<LineageLayer, number>(LAYER_ORDER.map((layer, index) => [layer, index]));

const layerAccent = (layer: LineageLayer): CSSProperties =>
  ({ ["--layerAccent" as string]: `var(--layer-${layer})` }) as CSSProperties;

export function AuditView({ graph }: AuditViewProps): JSX.Element {
  const orderedNodes = [...graph.nodes].sort(
    (a, b) => (LAYER_RANK.get(a.layer) ?? 0) - (LAYER_RANK.get(b.layer) ?? 0),
  );

  return (
    <div data-testid="audit-view" className={styles.audit}>
      {orderedNodes.map((node) => (
        <AuditRow key={node.id} node={node} upstreams={upstreamNamesOf(node.id, graph)} />
      ))}
    </div>
  );
}

function AuditRow({ node, upstreams }: { node: LineageNode; upstreams: string[] }): JSX.Element {
  return (
    <article
      data-testid={`audit-row-${node.id}`}
      className={clsx(styles.auditRow, node.orphan && styles.nodeOrphan)}
      style={layerAccent(node.layer)}
    >
      <div className={styles.auditHeader}>
        <span className={styles.nodeName}>{node.name}</span>
        <span className={styles.nodeKind}>{node.layer}</span>
        {node.orphan ? <span className={styles.badge}>Orphaned</span> : null}
      </div>
      <div data-testid={`audit-detail-${node.id}`} className={styles.auditDetail}>
        {upstreams.length > 0
          ? `Fed by: ${upstreams.join(", ")}`
          : "No upstream dependencies."}
      </div>
    </article>
  );
}

function upstreamNamesOf(nodeId: string, graph: LineageGraph): string[] {
  const nameById = new Map(graph.nodes.map((node) => [node.id, node.name]));
  return graph.edges
    .filter((edge) => edge.to === nodeId)
    .map((edge) => nameById.get(edge.from) ?? edge.from);
}
