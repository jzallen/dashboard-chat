import type { DatasetSparse } from "@/api";

import styles from "./DatasetGrid.module.css";

interface CompactDatasetCardProps {
  dataset: DatasetSparse;
  isSelected: boolean;
  onClick: () => void;
}

export function CompactDatasetCard({ dataset, isSelected, onClick }: CompactDatasetCardProps) {
  const fieldCount = Object.keys(dataset.schema_config.fields).length;

  return (
    <button
      className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}
      onClick={onClick}
    >
      <span className={styles.cardName}>{dataset.name}</span>
      <span className={styles.cardMeta}>{fieldCount} fields</span>
    </button>
  );
}
