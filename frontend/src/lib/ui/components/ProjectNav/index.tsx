import { useNavigate } from "react-router-dom";
import type { Project } from "@/api";
import { DatasetNavItem } from "./DatasetNavItem";
import styles from "./ProjectNav.module.css";

interface ProjectNavProps {
  project: Project | null;
  activeDatasetId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function ProjectNav({ project, activeDatasetId, collapsed, onToggleCollapse }: ProjectNavProps) {
  const navigate = useNavigate();

  const handleSelectDataset = (datasetId: string) => {
    if (!project) return;
    navigate(`/projects/${project.id}/datasets/${datasetId}`);
  };

  return (
    <nav className={`${styles.nav} ${collapsed ? styles.navCollapsed : styles.navExpanded}`}>
      <div className={styles.header}>
        {!collapsed && (
          <span className={styles.projectName}>
            {project?.name ?? "Loading..."}
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

      <div className={styles.datasetList}>
        {!project ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className={styles.skeleton}>
                <div className={`${styles.skeletonBar} ${i % 2 === 0 ? styles.skeletonBarShort : styles.skeletonBarMedium}`} />
              </div>
            ))}
          </>
        ) : (
          project.datasets.map((ds) => (
            <DatasetNavItem
              key={ds.id}
              id={ds.id}
              name={ds.name}
              isActive={ds.id === activeDatasetId}
              collapsed={collapsed}
              onClick={handleSelectDataset}
            />
          ))
        )}
      </div>
    </nav>
  );
}
