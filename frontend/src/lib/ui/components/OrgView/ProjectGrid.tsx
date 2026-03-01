import type { Project } from "@/api";

import styles from "./OrgView.module.css";
import { ProjectCard } from "./ProjectCard";

interface ProjectGridProps {
  projects: Project[];
  onSelect: (projectId: string) => void;
}

/** Renders a responsive grid of project cards with empty state handling. */
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
