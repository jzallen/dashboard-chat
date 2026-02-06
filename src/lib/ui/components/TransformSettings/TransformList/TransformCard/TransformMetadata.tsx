/**
 * Transform metadata display - conditions, version, and creation date
 */

import styles from "./TransformCard.module.css";

interface TransformMetadataProps {
  conditionCount: number;
}

export function TransformMetadata({ conditionCount }: TransformMetadataProps) {
  return (
    <div className={styles.metadataRow}>
      <span>{conditionCount} condition{conditionCount !== 1 ? "s" : ""}</span>
    </div>
  );
}
