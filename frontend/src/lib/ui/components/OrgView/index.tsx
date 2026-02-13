import { useNavigate, useOutletContext } from "react-router-dom";
import type { AppShellContext } from "../AppShell";
import { ProjectGrid } from "./ProjectGrid";
import styles from "./OrgView.module.css";

export function OrgView() {
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
