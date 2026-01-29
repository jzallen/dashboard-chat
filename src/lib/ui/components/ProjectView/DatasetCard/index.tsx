import { useState } from "react";
import type { DatasetSparse } from "@/api";
import { SchemaPreview } from "./SchemaPreview";
import styles from "../ProjectView.module.css";

interface DatasetCardProps {
  dataset: DatasetSparse;
  onSelect: (datasetId: string) => void;
}

export function DatasetCard({ dataset, onSelect }: DatasetCardProps) {
  const [expanded, setExpanded] = useState(false);

  const fieldCount = Object.keys(dataset.schema_config.fields).length;

  const handleCardClick = () => {
    setExpanded(!expanded);
  };

  const handleNameClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(dataset.id);
  };

  return (
    <div className={styles.datasetCard} onClick={handleCardClick}>
      <div className={styles.cardHeader}>
        <a
          href="#"
          className={styles.cardTitleLink}
          onClick={handleNameClick}
        >
          {dataset.name}
        </a>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className={`${styles.expandIcon} ${expanded ? styles.expandIconOpen : ""}`}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
          />
        </svg>
      </div>

      {dataset.description && (
        <div className={styles.cardDescription}>{dataset.description}</div>
      )}

      <div className={styles.cardMeta}>
        <span>{dataset.row_count.toLocaleString()} rows</span>
        <span className={styles.metaDot}>•</span>
        <span>{fieldCount} fields</span>
      </div>

      {expanded && <SchemaPreview schemaConfig={dataset.schema_config} />}
    </div>
  );
}
