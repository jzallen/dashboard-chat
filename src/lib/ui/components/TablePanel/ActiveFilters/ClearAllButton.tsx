import styles from "./ActiveFilters.module.css";

interface ClearAllButtonProps {
  onClick: () => void;
}

export function ClearAllButton({ onClick }: ClearAllButtonProps) {
  return (
    <button onClick={onClick} className={styles.clearAllButton}>
      Clear all
    </button>
  );
}
