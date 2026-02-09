import styles from "./ProjectNav.module.css";

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
      className={`${styles.navItem} ${isActive ? styles.navItemActive : ""}`}
      onClick={() => onClick(id)}
      title={collapsed ? name : undefined}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={styles.navItemIcon}
      >
        <path
          fillRule="evenodd"
          d="M.99 5.24A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25l.01 9.5A2.25 2.25 0 0116.76 17H3.26A2.25 2.25 0 011 14.75l-.01-9.5zm8.26 9.52v-.625a.75.75 0 00-.75-.75H3.25a.75.75 0 00-.75.75v.615c0 .414.336.75.75.75h5.373a.75.75 0 00.627-.34zM13.5 7a.75.75 0 00-.75.75v.625c0 .414.336.75.75.75h3.25a.75.75 0 00.75-.75V7.75a.75.75 0 00-.75-.75H13.5z"
          clipRule="evenodd"
        />
      </svg>
      {!collapsed && <span className={styles.navItemLabel}>{name}</span>}
    </button>
  );
}
