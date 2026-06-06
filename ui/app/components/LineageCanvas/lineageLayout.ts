/**
 * Lineage layout GEOMETRY — the lineage view's render compute. A dependency-free
 * library of pure layout math over the catalog: DAG node positions
 * (computeDagLayout) and edge Bézier paths (bezierPath), plus the layout
 * dimension config (DagDimensionConfig). No React, no JSX, no styling.
 *
 * It reads layer membership through the catalog's getNodesByLayer — the catalog
 * is the only model this view-side math knows about; its internal graph stays
 * private. Dependencies point inward: LineageCanvas → catalog, never the reverse.
 */
import { type DataCatalog, type Layer, LAYER_ORDER } from "../../catalog";

/**
 * DAG layout geometry (px): node box size, the gaps between boxes, and the
 * canvas padding around the whole grid.
 *
 *     paddingX                      columnGap
 *    ├────────┤                    ├─────────┤
 *             ┌──────────┐         ┌──────────┐ ─┐
 *             │          │         │          │  │ nodeHeight
 *             └──────────┘         └──────────┘ ─┘
 *             ├ nodeWidth┤
 *                   ┊ rowGap  (vertical gap to the node stacked below)
 *             ┌──────────┐         ┌──────────┐
 *             │          │         │          │
 *             └──────────┘         └──────────┘
 */
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

/** Result of {@link computeDagLayout}: where each node sits, plus the canvas size. */
export interface DagLayout {
  nodePositions: Record<string, Point>;
  width: number;
  height: number;
}

/**
 * Lay out the DAG: bucket nodes into one column per layer (in LAYER_ORDER),
 * size the content to the tallest column, then vertically center each shorter
 * column within that height. Returns absolute node positions (top-left corners)
 * plus the overall canvas width/height.
 *
 *      col 0       col 1       col 2       col 3
 *    (sources)   (staging)    (inter.)    (marts)
 *
 *                ┌───────┐                            ─┐
 *    ┌───────┐   │  stg  │   ┌───────┐   ┌───────┐     │
 *    │  src  │   ├───────┤   │  int  │   │ mart  │     │ contentHeight
 *    ├───────┤   │  stg  │   ├───────┤   ├───────┤     │ (= the tallest
 *    │  src  │   ├───────┤   │  int  │   │ mart  │     │   column, col 1)
 *    └───────┘   │  stg  │   └───────┘   └───────┘     │
 *                └───────┘                            ─┘
 *    └ shorter columns are centered against the tallest one
 *    ├ columnPitch ┤
 */
export function computeDagLayout(
  catalog: DataCatalog,
  dims: DagDimensions,
): DagLayout {
  // Stride from one node/column to the next: the node's own size plus the gap
  // that follows it. A run of N items therefore spans `N * pitch - gap` (the
  // last item has no trailing gap).
  const rowPitch = dims.nodeHeight + dims.rowGap;
  const columnPitch = dims.nodeWidth + dims.columnGap;

  // One column per layer, in pipeline order (sources → … → marts).
  const columns = LAYER_ORDER.map((layer: Layer) =>
    catalog.getNodesByLayer(layer),
  );

  // The tallest column sets the content height; shorter columns are centered
  // within it.
  const tallestColumnCount = Math.max(...columns.map((c) => c.length), 1);
  const contentHeight = tallestColumnCount * rowPitch - dims.rowGap;

  const nodePositions: Record<string, Point> = {};
  columns.forEach((column, columnIndex) => {
    const columnHeight = column.length * rowPitch - dims.rowGap;
    const columnTop = dims.paddingY + (contentHeight - columnHeight) / 2;
    const columnX = dims.paddingX + columnIndex * columnPitch;
    column.forEach((node, rowIndex) => {
      nodePositions[node.id] = {
        x: columnX,
        y: columnTop + rowIndex * rowPitch,
      };
    });
  });

  return {
    nodePositions,
    width:
      dims.paddingX * 2 + LAYER_ORDER.length * columnPitch - dims.columnGap,
    height: dims.paddingY * 2 + contentHeight,
  };
}

/**
 * SVG path `d` for an edge between two laid-out nodes: a horizontal S-curve that
 * starts at the source's right-middle, ends at the target's left-middle, and
 * places both Bézier control points at the horizontal midpoint between them.
 *
 *    source
 *   ┌───────┐
 *   │ src  ●│━━━━━━━━━━━┓  ◀ ctrl₁ = (midX, y1)
 *   └───────┘ (x1,y1)   ┃
 *                       ┃    both control points sit on
 *                       ┃    the vertical line x = midX
 *   ctrl₂ = (midX, y2)  ┗━━━━━━━━●┌───────┐
 *                         (x2,y2) │  tgt  │
 *                                 └───────┘
 *
 *   Sharing x = midX makes the curve leave the source and enter the target
 *   horizontally (flat tangents) regardless of the vertical gap between them.
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
