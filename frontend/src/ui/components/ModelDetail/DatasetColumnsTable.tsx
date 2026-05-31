// DatasetColumnsTable — model-detail columns table for the dataset layer (MR-5).
//
// Presentational: renders a dataset's schema_config fields as a columns table
// (name + type). Views/reports keep their existing layer-specific columns/measures
// tables (ViewSchemaTable / ColumnsMetadataTable); this fills the dataset layer.
// Pure over its props. Consumes MR-1 tokens.
import type { ColumnProfile, SchemaConfig } from "@/dataCatalog";

import styles from "./ModelDetail.module.css";

export interface DatasetColumnsTableProps {
  schema: SchemaConfig;
  /** Reserved for future profile-driven columns (sample values); not yet rendered. */
  profiles?: Record<string, ColumnProfile> | null;
}

export function DatasetColumnsTable({
  schema,
}: DatasetColumnsTableProps): JSX.Element {
  const entries = Object.entries(schema.fields ?? {});

  return (
    <section className={styles.section} data-testid="dataset-columns-section">
      <div className={styles.sectionTitle}>Columns</div>
      {entries.length === 0 ? (
        <div data-testid="dataset-columns-empty" className={styles.emptyState}>
          No columns.
        </div>
      ) : (
        <table className={styles.table} data-testid="dataset-columns-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, field]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{field.type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
