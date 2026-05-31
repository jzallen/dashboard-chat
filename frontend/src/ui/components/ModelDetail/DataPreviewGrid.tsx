// DataPreviewGrid — model-detail data preview section (MR-5).
//
// Presentational: when preview is available, renders a sample-rows grid; when a
// layer's preview is NOT served by the API today (views/reports — only datasets
// carry preview_rows, DWD-M5-6 / upstream-issues UI-6), renders an explicit
// "preview not yet available" empty-state. Pure over its props. Consumes MR-1
// tokens via ModelDetail.module.css. RED scaffold (created by DISTILL).
export const __SCAFFOLD__ = true;

export interface DataPreviewGridProps {
  /** False when the API does not serve sample rows for this layer (deferred c). */
  available: boolean;
  columns?: string[];
  rows?: Record<string, unknown>[];
  /** Cap on rendered rows (default 50). */
  maxRows?: number;
}

export function DataPreviewGrid(_props: DataPreviewGridProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (MR-5 DataPreviewGrid)");
}
