import type { Project } from "@/api";
import styles from "./OrgView.module.css";

interface ProjectCardProps {
  project: Project;
  onClick: () => void;
}

export function ProjectCard({ project, onClick }: ProjectCardProps) {
  const datasetCount = project.datasets?.length ?? 0;

  return (
    <button className={styles.card} onClick={onClick}>
      <span className={styles.cardName}>{project.name}</span>
      {project.description && (
        <span className={styles.cardDescription}>{project.description}</span>
      )}
      <span className={styles.cardMeta}>
        {datasetCount} dataset{datasetCount !== 1 ? "s" : ""}
      </span>
    </button>
  );
}
