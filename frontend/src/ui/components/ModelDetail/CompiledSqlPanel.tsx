// CompiledSqlPanel — model-detail compiled SQL section (MR-5).
//
// Presentational: a collapsible panel showing the model's compiled SQL with its
// ref() wiring (Report.sql_definition / Dataset.staging_sql / View.sql_definition).
// Renders an empty-state when no SQL is available. Pure over its props. Consumes
// MR-1 tokens.
import { useState } from "react";

import styles from "./ModelDetail.module.css";

export interface CompiledSqlPanelProps {
  sql?: string | null;
  title?: string;
}

export function CompiledSqlPanel({
  sql,
  title = "Compiled SQL",
}: CompiledSqlPanelProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <section className={styles.section} data-testid="compiled-sql">
      <div className={styles.sectionTitle}>{title}</div>
      {!sql ? (
        <div data-testid="compiled-sql-empty" className={styles.emptyState}>
          No compiled SQL available.
        </div>
      ) : (
        <>
          <button
            type="button"
            className={styles.sqlToggle}
            data-testid="compiled-sql-toggle"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide SQL ▲" : "Show SQL ▼"}
          </button>
          <span className={styles.hint}>ref() wiring shown inline.</span>
          {open && (
            <pre className={styles.sqlContent} data-testid="compiled-sql-content">
              <code>{sql}</code>
            </pre>
          )}
        </>
      )}
    </section>
  );
}
