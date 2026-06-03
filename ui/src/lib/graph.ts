/**
 * Lineage graph domain + layout logic — a dependency-free library of pure
 * operations over a {@link Graph} and its {@link LineageNode}s: no React, no
 * JSX, no styling, and no knowledge of where the data comes from. Callers
 * assemble a Graph (see src/app/catalog.ts) and pass it in.
 *
 * This is the lowest layer and owns the types it operates on (including the
 * {@link Layer} vocabulary). Dependencies point inward: src/app/* imports from
 * here, never the reverse.
 */

/** The pipeline layers, ordered left-to-right / upstream-to-downstream. */
export const LAYER_ORDER = ["source", "staging", "intermediate", "mart"] as const;

/**
 * A single data-pipeline layer. Derived from {@link LAYER_ORDER} so the list is
 * the single source of truth — add a layer there and this type follows.
 */
export type Layer = (typeof LAYER_ORDER)[number];

/** Audit stream skips the source layer — sources have no transforms. */
export const STREAM_LAYERS: Layer[] = LAYER_ORDER.slice(1);

/** A field/column descriptor as it appears in source schemas and model refs. */
export interface FieldDef {
  name: string;
  type: string;
}

/** One assistant audit entry: which tool ran and the human-readable summary. */
export interface AuditEntry {
  tool: string;
  say: string;
  tag: string;
}

/**
 * A model reference attached to staging/intermediate/mart nodes. Heterogeneous
 * by kind — datasets carry `fields`, views `columns`, reports `columns_metadata`
 * — so the field-list keys are all optional.
 */
export interface ModelRef {
  fields?: FieldDef[];
  columns?: unknown[];
  columns_metadata?: unknown[];
  [key: string]: unknown;
}

/** A node in the lineage graph: a raw source upload or a dbt model. */
export interface LineageNode {
  id: string;
  label: string;
  sub: string;
  layer: Layer;
  ref?: ModelRef; // absent for source nodes
  schema?: FieldDef[]; // source-only
  files?: { name: string; rows: number; when: string }[];
  audit?: AuditEntry[];
}

/** A directed edge `[from, to]` between two node ids. */
export type Edge = [string, string];

/** The assembled lineage graph: nodes keyed by id, plus directed edges. */
export interface Graph {
  nodes: Record<string, LineageNode>;
  edges: Edge[];
}

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
