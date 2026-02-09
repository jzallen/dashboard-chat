import styles from "./DatasetView.module.css";

interface BreadcrumbProps {
  projectName: string;
  datasetName?: string;
  onProjectClick?: () => void;
}

export function Breadcrumb({ projectName, datasetName, onProjectClick }: BreadcrumbProps) {
  return (
    <nav className={styles.breadcrumb}>
      <span className={styles.breadcrumbSeparator}>/</span>
      <span
        className={datasetName ? styles.breadcrumbItem : styles.breadcrumbItemCurrent}
        onClick={onProjectClick}
        role={onProjectClick ? "button" : undefined}
        tabIndex={onProjectClick ? 0 : undefined}
        onKeyDown={onProjectClick ? (e) => e.key === "Enter" && onProjectClick() : undefined}
      >
        {projectName}
      </span>
      {datasetName && (
        <>
          <span className={styles.breadcrumbSeparator}>/</span>
          <span className={styles.breadcrumbItemCurrent}>{datasetName}</span>
        </>
      )}
    </nav>
  );
}
