import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";

import styles from "./SideNav.module.css";

interface SideNavProps {
  orgName: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  children: React.ReactNode;
}

export function SideNav({ orgName, collapsed, onToggleCollapse, children }: SideNavProps) {
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
          {collapsed ? <ChevronRightIcon className={styles.collapseIcon} /> : <ChevronLeftIcon className={styles.collapseIcon} />}
        </button>
      </div>

      <div className={styles.body}>
        {children}
      </div>
    </nav>
  );
}
