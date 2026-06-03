/**
 * Lineage layout GEOMETRY — the lineage view's render compute. A dependency-free
 * library of pure layout math over the catalog: DAG node positions
 * (computeDagLayout) and edge Bézier paths (bezierPath), plus the layout
 * dimension config (DagDimensionConfig). No React, no JSX, no styling.
 *
 * It reads layer membership through the catalog's getNodesByLayer — the catalog
 * is the only model this view-side math knows about; its internal graph stays
 * private. Dependencies point inward: lineageCanvas → catalog, never the reverse.
 */
import { type DataCatalog, type Layer, LAYER_ORDER } from "../../lib/catalog";

/** DAG layout geometry (px): node width/height, column/row gaps, canvas padding. */
export interface DagDimensions {
  nodeWidth: number;
  nodeHeight: number;
  columnGap: number;
  rowGap: number;
  paddingX: number;
  paddingY: number;
}
export const DagDimensionConfig: DagDimensions = {
  nodeWidth: 186,
  nodeHeight: 96,
  columnGap: 54,
  rowGap: 28,
  paddingX: 16,
  paddingY: 16,
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
  dims: DagDimensions,
): DagLayout {
  const cols = LAYER_ORDER.map((layer: Layer) =>
    catalog.getNodesByLayer(layer),
  );
  const maxRows = Math.max(...cols.map((c) => c.length), 1);
  const contentH = maxRows * (dims.nodeHeight + dims.rowGap) - dims.rowGap;
  const pos: Record<string, Point> = {};
  cols.forEach((col, colIndex) => {
    const stackH = col.length * (dims.nodeHeight + dims.rowGap) - dims.rowGap;
    const startY = dims.paddingY + (contentH - stackH) / 2;
    col.forEach((n, rowIndex) => {
      pos[n.id] = {
        x: dims.paddingX + colIndex * (dims.nodeWidth + dims.columnGap),
        y: startY + rowIndex * (dims.nodeHeight + dims.rowGap),
      };
    });
  });
  return {
    pos,
    w:
      dims.paddingX * 2 +
      LAYER_ORDER.length * (dims.nodeWidth + dims.columnGap) -
      dims.columnGap,
    h: dims.paddingY * 2 + contentH,
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
  dims: DagDimensions,
): string {
  const x1 = sourcePos.x + dims.nodeWidth;
  const y1 = sourcePos.y + dims.nodeHeight / 2;
  const x2 = targetPos.x;
  const y2 = targetPos.y + dims.nodeHeight / 2;
  const midX = (x1 + x2) / 2;
  return `M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`;
}
