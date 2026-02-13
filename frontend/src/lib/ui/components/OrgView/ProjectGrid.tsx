import type { Project } from "@/api";
import { ProjectCard } from "./ProjectCard";
import styles from "./OrgView.module.css";

interface ProjectGridProps {
  projects: Project[];
  onSelect: (projectId: string) => void;
}

export function ProjectGrid({ projects, onSelect }: ProjectGridProps) {
  if (projects.length === 0) {
    return <div className={styles.emptyState}>No projects yet.</div>;
  }

  return (
    <div className={styles.grid}>
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          onClick={() => onSelect(project.id)}
        />
      ))}
    </div>
  );
}
