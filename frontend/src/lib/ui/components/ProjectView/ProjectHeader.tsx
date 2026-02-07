import styles from "./ProjectView.module.css";

interface ProjectHeaderProps {
  projectName: string;
}

export function ProjectHeader({ projectName }: ProjectHeaderProps) {
  return (
    <div className={styles.header}>
      <nav className={styles.breadcrumb}>
        <span className={styles.breadcrumbSeparator}>/</span>
        <span className={styles.breadcrumbItem}>{projectName}</span>
      </nav>
    </div>
  );
}
