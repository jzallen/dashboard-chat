import { useNavigate } from "react-router-dom";

import type { DatasetSparse, Project } from "@/api";

import { DatasetNavItem } from "./DatasetNavItem";
import { ProjectNavItem } from "./ProjectNavItem";
import styles from "./SideNav.module.css";

type SideNavProps = {
  orgName: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
} & (
  | { mode: "org"; projects: Project[]; activeProjectId: string | null }
  | { mode: "project"; project: Project; datasets: DatasetSparse[]; activeDatasetId: string | null }
);

export function SideNav(props: SideNavProps) {
  const { orgName, collapsed, onToggleCollapse } = props;
  const navigate = useNavigate();

  return (
    <nav className={`${styles.nav} ${collapsed ? styles.navCollapsed : styles.navExpanded}`}>
      <div className={styles.header}>
        {!collapsed && (
          <span className={styles.orgName}>
            {orgName ?? "Loading..."}
          </span>
        )}
        <button
          className={styles.collapseButton}
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={styles.collapseIcon}
          >
            {collapsed ? (
              <path
                fillRule="evenodd"
                d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z"
                clipRule="evenodd"
              />
            ) : (
              <path
                fillRule="evenodd"
                d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
                clipRule="evenodd"
              />
            )}
          </svg>
        </button>
      </div>

      <div className={styles.body}>
        {props.mode === "org" ? (
          <OrgBody
            projects={props.projects}
            activeProjectId={props.activeProjectId}
            collapsed={collapsed}
            onSelectProject={(id) => navigate(`/projects/${id}`)}
          />
        ) : (
          <ProjectBody
            project={props.project}
            datasets={props.datasets}
            activeDatasetId={props.activeDatasetId}
            collapsed={collapsed}
            onSelectProject={() => navigate(`/projects/${props.project.id}`)}
            onSelectDataset={(dsId) => navigate(`/projects/${props.project.id}/datasets/${dsId}`)}
          />
        )}
      </div>
    </nav>
  );
}

function OrgBody({
  projects,
  activeProjectId,
  collapsed,
  onSelectProject,
}: {
  projects: Project[];
  activeProjectId: string | null;
  collapsed: boolean;
  onSelectProject: (id: string) => void;
}) {
  if (projects.length === 0) {
    return (
      <>
        {[1, 2, 3].map((i) => (
          <div key={i} className={styles.skeleton}>
            <div className={`${styles.skeletonBar} ${i % 2 === 0 ? styles.skeletonBarShort : styles.skeletonBarMedium}`} />
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {projects.map((p) => (
        <ProjectNavItem
          key={p.id}
          id={p.id}
          name={p.name}
          datasetCount={p.datasets?.length ?? 0}
          isActive={p.id === activeProjectId}
          collapsed={collapsed}
          onClick={onSelectProject}
        />
      ))}
    </>
  );
}

function ProjectBody({
  project,
  datasets,
  activeDatasetId,
  collapsed,
  onSelectProject,
  onSelectDataset,
}: {
  project: Project;
  datasets: DatasetSparse[];
  activeDatasetId: string | null;
  collapsed: boolean;
  onSelectProject: () => void;
  onSelectDataset: (id: string) => void;
}) {
  return (
    <>
      {/* Project heading */}
      <button className={styles.projectHeading} onClick={onSelectProject}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={styles.projectHeadingIcon}
        >
          <path d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75zM3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z" />
        </svg>
        {!collapsed && <span>{project.name}</span>}
      </button>

      {/* Datasets section */}
      {!collapsed && <div className={styles.sectionLabel}>datasets</div>}

      {datasets.map((ds) => (
        <DatasetNavItem
          key={ds.id}
          id={ds.id}
          name={ds.name}
          isActive={ds.id === activeDatasetId}
          collapsed={collapsed}
          onClick={onSelectDataset}
        />
      ))}
    </>
  );
}
