import type { Project } from "@/api";

import { ProjectNavItem } from "./ProjectNavItem";
import styles from "./SideNav.module.css";

interface OrgNavProps {
  projects: Project[];
  activeProjectId: string | null;
  collapsed: boolean;
  onSelectProject: (id: string) => void;
}

export function OrgNav({ projects, activeProjectId, collapsed, onSelectProject }: OrgNavProps) {
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
