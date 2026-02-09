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
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={styles.modeIcon}>
          <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v2.5A2.25 2.25 0 0 0 4.25 9h2.5A2.25 2.25 0 0 0 9 6.75v-2.5A2.25 2.25 0 0 0 6.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 2 13.25v2.5A2.25 2.25 0 0 0 4.25 18h2.5A2.25 2.25 0 0 0 9 15.75v-2.5A2.25 2.25 0 0 0 6.75 11h-2.5Zm9-9A2.25 2.25 0 0 0 11 4.25v2.5A2.25 2.25 0 0 0 13.25 9h2.5A2.25 2.25 0 0 0 18 6.75v-2.5A2.25 2.25 0 0 0 15.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 11 13.25v2.5A2.25 2.25 0 0 0 13.25 18h2.5A2.25 2.25 0 0 0 18 15.75v-2.5A2.25 2.25 0 0 0 15.75 11h-2.5Z" clipRule="evenodd" />
        </svg>
      </button>
      <button
        className={`${styles.modeButton} ${mode === "table" ? styles.modeButtonActive : ""}`}
        onClick={() => onModeChange("table")}
        aria-label="Table view"
        title="Table view"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={styles.modeIcon}>
          <path fillRule="evenodd" d="M.99 5.24A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25l.01 9.5A2.25 2.25 0 0 1 16.76 17H3.26A2.25 2.25 0 0 1 1 14.76l-.01-9.52ZM3.25 4.5a.75.75 0 0 0-.75.75v1h15v-1a.75.75 0 0 0-.75-.75H3.25ZM2.5 7.75v2h6.5v-2h-6.5Zm0 3.5v2h6.5v-2h-6.5Zm8 2v-2H17v2h-6.5Zm6.5-3.5v-2h-6.5v2H17Z" clipRule="evenodd" />
        </svg>
      </button>
    </div>
  );
}
