/**
 * SQL preview display for cached transform SQL
 */

import styles from "./TransformCard.module.css";

interface SQLPreviewProps {
  sql: string;
}

export function SQLPreview({ sql }: SQLPreviewProps) {
  return (
    <div className={styles.sqlPreview}>
      {sql}
    </div>
  );
}
