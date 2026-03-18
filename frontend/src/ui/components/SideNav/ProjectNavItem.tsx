import { FolderIcon } from "@heroicons/react/20/solid";

import styles from "./SideNav.module.css";

interface ProjectNavItemProps {
  id: string;
  name: string;
  datasetCount: number;
  isActive: boolean;
  collapsed: boolean;
  onClick: (id: string) => void;
}

export function ProjectNavItem({ id, name, datasetCount, isActive, collapsed, onClick }: ProjectNavItemProps) {
  return (
    <button
      className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
      data-testid={`project-nav-${id}`}
      onClick={() => onClick(id)}
      title={collapsed ? name : undefined}
    >
      <FolderIcon className={styles.navItemIcon} />
      {!collapsed && (
        <>
          <span className={styles.navItemLabel}>{name}</span>
          <span className={styles.navItemCount}>{datasetCount}</span>
        </>
      )}
    </button>
  );
}
