import {
  ChartBarIcon,
  EyeIcon,
  FolderIcon,
} from "@heroicons/react/20/solid";

import type { DatasetSparse, Project, Report, View } from "@/dataCatalog";

import { DatasetNavItem } from "./DatasetNavItem";
import styles from "./SideNav.module.css";

interface NavItemProps {
  id: string;
  name: string;
  isActive: boolean;
  collapsed: boolean;
  onClick: (id: string) => void;
  icon: React.ReactNode;
}

function GenericNavItem({ id, name, isActive, collapsed, onClick, icon }: NavItemProps) {
  return (
    <button
      className={`${styles.navItem} ${styles.navItemIndented} ${isActive ? styles.navItemActive : ""}`}
      onClick={() => onClick(id)}
      title={collapsed ? name : undefined}
    >
      {icon}
      {!collapsed && <span className={styles.navItemLabel}>{name}</span>}
    </button>
  );
}

interface ProjectNavProps {
  project: Project;
  datasets: DatasetSparse[];
  views?: View[];
  reports?: Report[];
  activeDatasetId: string | null;
  activeViewId?: string | null;
  activeReportId?: string | null;
  collapsed: boolean;
  onSelectProject: () => void;
  onSelectDataset: (id: string) => void;
  onSelectView?: (id: string) => void;
  onSelectReport?: (id: string) => void;
}

export function ProjectNav({
  project,
  datasets,
  views = [],
  reports = [],
  activeDatasetId,
  activeViewId = null,
  activeReportId = null,
  collapsed,
  onSelectProject,
  onSelectDataset,
  onSelectView,
  onSelectReport,
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

      {/* Views section */}
      {views.length > 0 && (
        <>
          {!collapsed && <div className={styles.sectionLabel}>views</div>}
          {views.map((v) => (
            <GenericNavItem
              key={v.id}
              id={v.id}
              name={v.name}
              isActive={v.id === activeViewId}
              collapsed={collapsed}
              onClick={onSelectView ?? (() => {})}
              icon={<EyeIcon className={styles.navItemIcon} />}
            />
          ))}
        </>
      )}

      {/* Reports section */}
      {reports.length > 0 && (
        <>
          {!collapsed && <div className={styles.sectionLabel}>reports</div>}
          {reports.map((r) => (
            <GenericNavItem
              key={r.id}
              id={r.id}
              name={r.name}
              isActive={r.id === activeReportId}
              collapsed={collapsed}
              onClick={onSelectReport ?? (() => {})}
              icon={<ChartBarIcon className={styles.navItemIcon} />}
            />
          ))}
        </>
      )}
    </>
  );
}
