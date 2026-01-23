/**
 * Transform metadata display - conditions, version, and creation date
 */

import styles from "./TransformCard.module.css";

interface TransformMetadataProps {
  conditionCount: number;
  version: number;
  createdDate: string;
}

export function TransformMetadata({ conditionCount, version, createdDate }: TransformMetadataProps) {
  return (
    <div className={styles.metadataRow}>
      <span>{conditionCount} condition{conditionCount !== 1 ? "s" : ""}</span>
      <span>·</span>
      <span>v{version}</span>
      <span>·</span>
      <span>{createdDate}</span>
    </div>
  );
}
