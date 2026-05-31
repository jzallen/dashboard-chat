// DataPreviewGrid — model-detail data preview section (MR-5).
//
// Presentational: when preview is available, renders a sample-rows grid; when a
// layer's preview is NOT served by the API today (views/reports — only datasets
// carry preview_rows, DWD-M5-6 / upstream-issues UI-6), renders an explicit
// "preview not yet available" empty-state. Pure over its props. Consumes MR-1 tokens.
import styles from "./ModelDetail.module.css";

export interface DataPreviewGridProps {
  /** False when the API does not serve sample rows for this layer (deferred c). */
  available: boolean;
  columns?: string[];
  rows?: Record<string, unknown>[];
  /** Cap on rendered rows (default 50). */
  maxRows?: number;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function DataPreviewGrid({
  available,
  columns = [],
  rows = [],
  maxRows = 50,
}: DataPreviewGridProps): JSX.Element {
  return (
    <section className={styles.previewSection} data-testid="data-preview">
      <div className={styles.sectionTitle}>Data preview</div>
      {!available ? (
        <div data-testid="data-preview-unavailable" className={styles.emptyState}>
          Preview not yet available for this layer.
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="data-preview-empty" className={styles.emptyState}>
          No rows to preview.
        </div>
      ) : (
        <div className={styles.previewScroll}>
          <table className={styles.table} data-testid="data-preview-grid">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, maxRows).map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column}>{formatCell(row[column])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
