import { TableCellsIcon } from "@heroicons/react/20/solid";

import styles from "./SideNav.module.css";

interface DatasetNavItemProps {
  id: string;
  name: string;
  isActive: boolean;
  collapsed: boolean;
  onClick: (id: string) => void;
}

export function DatasetNavItem({ id, name, isActive, collapsed, onClick }: DatasetNavItemProps) {
  return (
    <button
      className={`${styles.navItem} ${styles.navItemIndented} ${isActive ? styles.navItemActive : ""}`}
      onClick={() => onClick(id)}
      title={collapsed ? name : undefined}
    >
      <TableCellsIcon className={styles.navItemIcon} />
      {!collapsed && <span className={styles.navItemLabel}>{name}</span>}
    </button>
  );
}
