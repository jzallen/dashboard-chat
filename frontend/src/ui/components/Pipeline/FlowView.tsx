// FlowView — left→right lineage DAG (MR-2).
//
// Renders the graph as a layered left→right flow: nodes grouped into layer
// columns (source → staging → intermediate → mart), edges drawn between them.
// Orphan nodes render DISABLED (aria-disabled). Consumes MR-1 layer-accent tokens.
import clsx from "clsx";
import type { CSSProperties } from "react";

import type { LineageGraph, LineageLayer, LineageNode } from "../../../core/lineage/buildGraph";
import styles from "./Pipeline.module.css";

export interface FlowViewProps {
  graph: LineageGraph;
  /** MR-6: when provided, nodes become activatable (e.g. open the upload modal for a source). */
  onNodeActivate?: (node: LineageNode) => void;
}

// Left→right column order. `source` is reserved for MR-6 (no nodes in MR-2) but
// kept in the ordering so it slots in correctly when it arrives.
const LAYER_ORDER: readonly LineageLayer[] = ["source", "staging", "intermediate", "mart"];

const layerAccent = (layer: LineageLayer): CSSProperties =>
  ({ ["--layerAccent" as string]: `var(--layer-${layer})` }) as CSSProperties;

export function FlowView({ graph, onNodeActivate }: FlowViewProps): JSX.Element {
  return (
    <div data-testid="flow-view" className={styles.flow}>
      {LAYER_ORDER.map((layer) => nodesInLayer(graph.nodes, layer)).map(
        (nodes, index) =>
          nodes.length > 0 ? (
            <FlowLayerColumn
              key={LAYER_ORDER[index]}
              layer={LAYER_ORDER[index]}
              nodes={nodes}
              onNodeActivate={onNodeActivate}
            />
          ) : null,
      )}
      <ul data-testid="flow-edges" className={styles.edges}>
        {graph.edges.map((edge) => (
          <li
            key={`${edge.from}->${edge.to}`}
            data-testid={`flow-edge-${edge.from}-${edge.to}`}
            className={styles.edge}
          >
            {edge.from} → {edge.to}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FlowLayerColumn({
  layer,
  nodes,
  onNodeActivate,
}: {
  layer: LineageLayer;
  nodes: LineageNode[];
  onNodeActivate?: (node: LineageNode) => void;
}): JSX.Element {
  return (
    <div
      data-testid={`flow-layer-${layer}`}
      className={styles.flowLayer}
      style={layerAccent(layer)}
    >
      <span className={styles.flowLayerHeading}>{layer}</span>
      {nodes.map((node) => (
        <FlowNode key={node.id} node={node} onNodeActivate={onNodeActivate} />
      ))}
    </div>
  );
}

function FlowNode({
  node,
  onNodeActivate,
}: {
  node: LineageNode;
  onNodeActivate?: (node: LineageNode) => void;
}): JSX.Element {
  const activatable = Boolean(onNodeActivate);
  return (
    <div
      data-testid={`flow-node-${node.id}`}
      className={clsx(styles.node, node.orphan && styles.nodeOrphan)}
      aria-disabled={node.orphan ? "true" : undefined}
      role={activatable ? "button" : undefined}
      tabIndex={activatable ? 0 : undefined}
      onClick={activatable ? () => onNodeActivate!(node) : undefined}
      onKeyDown={
        activatable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onNodeActivate!(node);
              }
            }
          : undefined
      }
    >
      <span className={styles.nodeName}>{node.name}</span>
      <span className={styles.nodeKind}>{node.kind}</span>
    </div>
  );
}

function nodesInLayer(nodes: LineageNode[], layer: LineageLayer): LineageNode[] {
  return nodes.filter((node) => node.layer === layer);
}
