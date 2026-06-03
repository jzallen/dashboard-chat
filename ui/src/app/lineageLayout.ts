/**
 * Lineage layout GEOMETRY — the lineage view's render compute. A dependency-free
 * library of pure layout math over the catalog: DAG node positions
 * (computeDagLayout) and edge Bézier paths (bezierPath), plus the layout
 * constants (DAG, STREAM_LAYERS) and the re-exported LAYER_ORDER. No React, no
 * JSX, no styling.
 *
 * It reads layer membership through the catalog's getNodesByLayer — the catalog
 * is the only model this view-side math knows about; its internal graph stays
 * private. Dependencies point inward: lineageLayout → catalog, never the reverse.
 */
import { type DataCatalog, type Layer, LAYER_ORDER } from "../lib/catalog";

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

/**
 * Lay out the DAG: bucket nodes into one column per layer (in LAYER_ORDER),
 * find the tallest column (maxRows) to size the content height, then vertically
 * center each shorter column within that height. Width spans LAYER_ORDER.length
 * columns. Returns absolute node positions plus the canvas width/height.
 */
export function computeDagLayout(
  catalog: DataCatalog,
  dims: DagDims,
): DagLayout {
  const cols = LAYER_ORDER.map((layer: Layer) => catalog.getNodesByLayer(layer));
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
