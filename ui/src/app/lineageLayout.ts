/**
 * Lineage layout geometry + graph queries — the lineage view's render compute.
 * A dependency-free library of pure operations over a {@link Graph} and its
 * {@link LineageNode}s: no React, no JSX, no styling. Callers assemble a Graph
 * (via the catalog) and pass it in.
 *
 * The entity types it operates on are owned by the catalog (src/lib/catalog);
 * this module imports them and adds the view-side layout math. Dependencies
 * point inward: lineageLayout → catalog, never the reverse.
 */
import {
  type Graph,
  type Layer,
  LAYER_ORDER,
  type LineageNode,
} from "../lib/catalog";

/** Re-exported so the lineage view can source all its ops from one module. */
export { LAYER_ORDER };

/** Audit stream skips the source layer — sources have no transforms. */
export const STREAM_LAYERS: Layer[] = LAYER_ORDER.slice(1);

/** DAG layout geometry (px): node width/height, column/row gaps, canvas padding. */
export interface DagDims {
  NW: number;
  NH: number;
  COLGAP: number;
  ROWGAP: number;
  PADX: number;
  PADY: number;
}
export const DAG: DagDims = {
  NW: 186,
  NH: 96,
  COLGAP: 54,
  ROWGAP: 28,
  PADX: 16,
  PADY: 16,
};

/** A laid-out node position (top-left corner, absolute within the canvas). */
export interface Point {
  x: number;
  y: number;
}

/** Result of {@link computeDagLayout}: node positions plus canvas dimensions. */
export interface DagLayout {
  pos: Record<string, Point>;
  w: number;
  h: number;
}

/** All nodes in `graph` belonging to the given pipeline `layer`. */
export function nodesInLayer(graph: Graph, layer: Layer): LineageNode[] {
  return Object.values(graph.nodes).filter((n) => n.layer === layer);
}

/** Ids of non-source nodes with no incoming edge — dangling, unconnected models. */
export function orphanSet(graph: Graph): Set<string> {
  const hasIncoming = new Set(graph.edges.map(([, b]) => b));
  const orphans = new Set<string>();
  Object.values(graph.nodes).forEach((n) => {
    if (n.layer !== "source" && !hasIncoming.has(n.id)) orphans.add(n.id);
  });
  return orphans;
}

/** True if a direct edge connects `focus` and `id` in either direction. */
export function isAdjacent(graph: Graph, focus: string, id: string): boolean {
  return graph.edges.some(
    ([a, b]) => (a === focus && b === id) || (b === focus && a === id),
  );
}

/**
 * Lay out the DAG: bucket nodes into one column per layer (in LAYER_ORDER),
 * find the tallest column (maxRows) to size the content height, then vertically
 * center each shorter column within that height. Width spans LAYER_ORDER.length
 * columns. Returns absolute node positions plus the canvas width/height.
 */
export function computeDagLayout(graph: Graph, dims: DagDims): DagLayout {
  const cols = LAYER_ORDER.map((layer) => nodesInLayer(graph, layer));
  const maxRows = Math.max(...cols.map((c) => c.length), 1);
  const contentH = maxRows * (dims.NH + dims.ROWGAP) - dims.ROWGAP;
  const pos: Record<string, Point> = {};
  cols.forEach((col, colIndex) => {
    const stackH = col.length * (dims.NH + dims.ROWGAP) - dims.ROWGAP;
    const startY = dims.PADY + (contentH - stackH) / 2;
    col.forEach((n, rowIndex) => {
      pos[n.id] = {
        x: dims.PADX + colIndex * (dims.NW + dims.COLGAP),
        y: startY + rowIndex * (dims.NH + dims.ROWGAP),
      };
    });
  });
  return {
    pos,
    w: dims.PADX * 2 + LAYER_ORDER.length * (dims.NW + dims.COLGAP) - dims.COLGAP,
    h: dims.PADY * 2 + contentH,
  };
}

/**
 * SVG path `d` for an edge between two laid-out nodes: a horizontal S-curve that
 * starts at the source's right-middle, ends at the target's left-middle, and
 * places both Bézier control points at the horizontal midpoint between them.
 */
export function bezierPath(
  sourcePos: Point,
  targetPos: Point,
  dims: DagDims,
): string {
  const x1 = sourcePos.x + dims.NW;
  const y1 = sourcePos.y + dims.NH / 2;
  const x2 = targetPos.x;
  const y2 = targetPos.y + dims.NH / 2;
  const midX = (x1 + x2) / 2;
  return `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
}
