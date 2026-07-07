/* /query-engines — compute-management stub. */
import styles from "./query-engines.module.css";

export default function QueryEnginesRoute() {
  return (
    <div className={styles.container}>
      <h1 className={`serif ${styles.heading}`}>Query Engines</h1>
      <p className={styles.subheading}>
        DuckDB · connected. Manage compute for previews and exports.
      </p>
    </div>
  );
}
