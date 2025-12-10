import styles from "./ChatPanel.module.css";

export function ChatEmptyState() {
  return (
    <div className={styles.emptyState}>
      <p className={styles.emptyStateSubtitle}>
        Start a conversation to control the table
      </p>
      <div className={styles.examplesBox}>
        <p className={styles.examplesTitle}>Examples:</p>
        <p>"Filter by category Electronics"</p>
        <p>"Sort by amount descending"</p>
        <p>"Show items not in stock"</p>
        <p>"Add a new item called Test with amount 99"</p>
        <p>"Delete the first row"</p>
      </div>
    </div>
  );
}
