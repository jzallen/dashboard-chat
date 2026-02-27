import type { SchemaConfig } from "@/api";

import { FieldRow } from "./FieldRow";
import styles from "./SchemaTable.module.css";

interface SchemaTableProps {
  schemaConfig: SchemaConfig;
}

export function SchemaTable({ schemaConfig }: SchemaTableProps) {
  const fields = Object.entries(schemaConfig.fields);

  if (fields.length === 0) {
    return <div className={styles.emptyState}>No fields defined</div>;
  }

  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <thead>
          <tr className={styles.headerRow}>
            <th className={styles.headerCell}>Field Name</th>
            <th className={styles.headerCell}>Type</th>
            <th className={styles.headerCell}>Description</th>
            <th className={styles.headerCell}>Nullable</th>
          </tr>
        </thead>
        <tbody>
          {fields.map(([fieldName, config]) => (
            <FieldRow key={fieldName} fieldName={fieldName} config={config} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
