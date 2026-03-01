import { FolderIcon } from "@heroicons/react/20/solid";

import type { DatasetSparse, Project } from "@/api";

import { DatasetNavItem } from "./DatasetNavItem";
import styles from "./SideNav.module.css";

interface ProjectNavProps {
  project: Project;
  datasets: DatasetSparse[];
  activeDatasetId: string | null;
  collapsed: boolean;
  onSelectProject: () => void;
  onSelectDataset: (id: string) => void;
}

export function ProjectNav({
  project,
  datasets,
  activeDatasetId,
  collapsed,
  onSelectProject,
  onSelectDataset,
}: ProjectNavProps) {
  return (
    <>
      {/* Project heading */}
      <button className={styles.projectHeading} onClick={onSelectProject}>
        <FolderIcon className={styles.projectHeadingIcon} />
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
