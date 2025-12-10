import styles from "./TablePanel.module.css";

export function TableHeader() {
  return (
    <div className={styles.header}>
      <h1 className={styles.title}>Quill Table Demo</h1>
      <p className={styles.subtitle}>
        Chat with the AI to filter, sort, add, or delete rows
      </p>
    </div>
  );
}
