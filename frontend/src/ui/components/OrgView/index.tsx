import { useNavigate, useOutletContext } from "react-router";

import type { AppShellContext } from "../AppShell";
import styles from "./OrgView.module.css";
import { ProjectGrid } from "./ProjectGrid";

/** Org-level landing page displaying a grid of projects. */
export function ProjectsPage() {
  const { projects } = useOutletContext<AppShellContext>();
  const navigate = useNavigate();

  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Projects</h2>
      <ProjectGrid
        projects={projects ?? []}
        onSelect={(id) => navigate(`/projects/${id}`)}
      />
    </div>
  );
}
