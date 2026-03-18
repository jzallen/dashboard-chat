import { Squares2X2Icon, TableCellsIcon } from "@heroicons/react/20/solid";

import styles from "./DatasetView.module.css";

export type ViewMode = "catalog" | "table";

interface ViewModeToggleProps {
  mode: ViewMode;
  onModeChange: (mode: ViewMode) => void;
}

export function ViewModeToggle({ mode, onModeChange }: ViewModeToggleProps) {
  return (
    <div className={styles.modeToggle}>
      <button
        className={`${styles.modeButton} ${mode === "catalog" ? styles.modeButtonActive : ""}`}
        onClick={() => onModeChange("catalog")}
        aria-label="Catalog view"
        title="Catalog view"
      >
        <Squares2X2Icon className={styles.modeIcon} />
      </button>
      <button
        className={`${styles.modeButton} ${mode === "table" ? styles.modeButtonActive : ""}`}
        onClick={() => onModeChange("table")}
        aria-label="Table view"
        title="Table view"
      >
        <TableCellsIcon className={styles.modeIcon} />
      </button>
    </div>
  );
}
