import type { SchemaConfig } from "@/api";
import styles from "../ProjectView.module.css";

interface SchemaPreviewProps {
  schemaConfig: SchemaConfig;
}

export function SchemaPreview({ schemaConfig }: SchemaPreviewProps) {
  const fields = Object.entries(schemaConfig.fields);

  return (
    <div className={styles.schemaPreview}>
      <div className={styles.schemaTitle}>Schema</div>
      <table className={styles.schemaTable}>
        <thead>
          <tr>
            <th className={styles.schemaTableHeader}>Name</th>
            <th className={styles.schemaTableHeader}>Type</th>
            <th className={styles.schemaTableHeader}>Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([fieldName, config]) => (
            <tr key={fieldName} className={styles.schemaTableRow}>
              <td className={styles.schemaTableCell}>{config.label}</td>
              <td className={styles.schemaTableCellType}>{config.type}</td>
              <td className={styles.schemaTableCellDesc}>
                {(config as { description?: string }).description ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
