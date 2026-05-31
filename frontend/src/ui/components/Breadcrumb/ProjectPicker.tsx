// Searchable project picker popover (MR-3, path-forward §4.1).
//
// Opened from the breadcrumb's `Project ▾` crumb. Renders a search box that
// filters the org's projects by name (case-insensitive); selecting a project
// navigates to the MR-2 Pipeline landing (`projects/:projectId/pipeline`). Data
// comes from the existing org-projects query hook (NOT ui-state).
import { useState } from "react";

import type { Project } from "@/dataCatalog";

import styles from "./Breadcrumb.module.css";

export interface ProjectPickerProps {
  projects: Project[];
  currentProjectId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectPicker({
  projects,
  currentProjectId,
  onSelect,
}: ProjectPickerProps): JSX.Element {
  const [query, setQuery] = useState("");

  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className={styles.picker} role="dialog">
      <input
        data-testid="project-picker-search"
        className={styles.search}
        placeholder="Search projects…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {filtered.map((project) => (
        <button
          key={project.id}
          type="button"
          data-testid={`project-option-${project.id}`}
          className={
            project.id === currentProjectId
              ? `${styles.option} ${styles.optionActive}`
              : styles.option
          }
          onClick={() => onSelect(project.id)}
        >
          {project.name}
        </button>
      ))}
    </div>
  );
}

export default ProjectPicker;
