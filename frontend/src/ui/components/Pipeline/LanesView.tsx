// LanesView — layer swimlanes (MR-2).
//
// Renders one horizontal swimlane per present layer (staging / intermediate /
// mart in MR-2; source reserved for MR-6), placing each node in its layer's lane.
// Orphan nodes carry an "Orphaned" badge. Consumes MR-1 layer-accent tokens.
import clsx from "clsx";
import type { CSSProperties } from "react";

import type { LineageGraph, LineageLayer, LineageNode } from "../../../core/lineage/buildGraph";
import styles from "./Pipeline.module.css";

export interface LanesViewProps {
  graph: LineageGraph;
  /** MR-6: when provided, nodes become activatable (e.g. open the upload modal for a source). */
  onNodeActivate?: (node: LineageNode) => void;
}

const LAYER_ORDER: readonly LineageLayer[] = ["source", "staging", "intermediate", "mart"];

const layerAccent = (layer: LineageLayer): CSSProperties =>
  ({ ["--layerAccent" as string]: `var(--layer-${layer})` }) as CSSProperties;

export function LanesView({ graph, onNodeActivate }: LanesViewProps): JSX.Element {
  return (
    <div data-testid="lanes-view" className={styles.lanes}>
      {LAYER_ORDER.map((layer) => ({
        layer,
        nodes: graph.nodes.filter((node) => node.layer === layer),
      }))
        .filter((lane) => lane.nodes.length > 0)
        .map((lane) => (
          <Lane key={lane.layer} layer={lane.layer} nodes={lane.nodes} onNodeActivate={onNodeActivate} />
        ))}
    </div>
  );
}

function Lane({
  layer,
  nodes,
  onNodeActivate,
}: {
  layer: LineageLayer;
  nodes: LineageNode[];
  onNodeActivate?: (node: LineageNode) => void;
}): JSX.Element {
  return (
    <section data-testid={`lane-${layer}`} className={styles.lane} style={layerAccent(layer)}>
      <h3 className={styles.laneHeading}>{layer}</h3>
      <div className={styles.laneNodes}>
        {nodes.map((node) => (
          <LaneNode key={node.id} node={node} onNodeActivate={onNodeActivate} />
        ))}
      </div>
    </section>
  );
}

function LaneNode({
  node,
  onNodeActivate,
}: {
  node: LineageNode;
  onNodeActivate?: (node: LineageNode) => void;
}): JSX.Element {
  const activatable = Boolean(onNodeActivate);
  return (
    <div
      data-testid={`lanes-node-${node.id}`}
      className={clsx(styles.node, node.orphan && styles.nodeOrphan)}
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
      {node.orphan ? <span className={styles.badge}>Orphaned</span> : null}
    </div>
  );
}
