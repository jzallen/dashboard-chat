import { useNavigate, useOutletContext } from "react-router";

import { ThemeToggle } from "../../../../app/theme/ThemeToggle";
import type { AppShellContext } from "../AppShell";
import styles from "./OrgView.module.css";
import { ProjectGrid } from "./ProjectGrid";

/** Org-level landing page displaying a grid of projects. */
export function ProjectsPage() {
  const { projects } = useOutletContext<AppShellContext>();
  const navigate = useNavigate();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h2 className={styles.heading}>Projects</h2>
        <div className={styles.appearance}>
          <span className={styles.appearanceLabel}>Appearance</span>
          <ThemeToggle />
        </div>
      </header>
      <ProjectGrid
        projects={projects ?? []}
        onSelect={(id) => navigate(`/projects/${id}`)}
      />
    </div>
  );
}
