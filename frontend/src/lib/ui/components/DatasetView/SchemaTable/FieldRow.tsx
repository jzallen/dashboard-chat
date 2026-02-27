import type { FieldConfig } from "@/api";

import styles from "./SchemaTable.module.css";

interface FieldRowProps {
  fieldName: string;
  config: FieldConfig;
}

const TYPE_BADGE_CLASS: Record<string, string> = {
  text: "badgeText",
  number: "badgeNumber",
  boolean: "badgeBoolean",
  datetime: "badgeDatetime",
  select: "badgeSelect",
};

export function FieldRow({ fieldName, config }: FieldRowProps) {
  const badgeClass = TYPE_BADGE_CLASS[config.type] ?? "badgeText";

  return (
    <tr className={styles.row}>
      <td className={styles.cellName}>{config.label || fieldName}</td>
      <td className={styles.cellType}>
        <span className={`${styles.typeBadge} ${styles[badgeClass]}`}>
          {config.type}
        </span>
      </td>
      <td className={styles.cellDescription}>
        {(config as { description?: string }).description ?? "—"}
      </td>
      <td className={styles.cellNullable}>
        {config.nullable ? "Yes" : "No"}
      </td>
    </tr>
  );
}
