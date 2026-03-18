import type { DatasetSparse } from "@/dataCatalog";

import styles from "./DatasetGrid.module.css";

const layerColors: Record<string, string> = {
  dataset: "#dbeafe",
  view: "#f3e8ff",
  report: "#dcfce7",
};

const layerTextColors: Record<string, string> = {
  dataset: "#1e40af",
  view: "#6b21a8",
  report: "#166534",
};

interface CompactDatasetCardProps {
  dataset: DatasetSparse;
  isSelected: boolean;
  onClick: () => void;
  layerType?: "dataset" | "view" | "report";
}

export function CompactDatasetCard({ dataset, isSelected, onClick, layerType = "dataset" }: CompactDatasetCardProps) {
  const fieldCount = Object.keys(dataset.schema_config.fields).length;

  return (
    <button
      className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}
      onClick={onClick}
    >
      <span className={styles.cardName}>{dataset.name}</span>
      <span style={{ display: "flex", alignItems: "center", gap: "0.375rem" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            borderRadius: "9999px",
            padding: "0 0.375rem",
            fontSize: "0.625rem",
            fontWeight: 500,
            lineHeight: "1rem",
            backgroundColor: layerColors[layerType] ?? layerColors.dataset,
            color: layerTextColors[layerType] ?? layerTextColors.dataset,
          }}
        >
          {layerType}
        </span>
        <span className={styles.cardMeta}>{fieldCount} fields</span>
      </span>
    </button>
  );
}
