// Org Settings sheet (MR-3).
//
// Rendered by AppShell when the breadcrumb's org icon toggles the `?org=1` search
// param. A darker inset backdrop hosts the existing org settings surface (the MR-1
// Appearance / dark-mode ThemeToggle plus the project grid). Clicking the backdrop
// or the close control clears the param. Selecting a project navigates to its MR-2
// Pipeline landing and closes the sheet. path-forward §4.1 / §4.2.
import { useNavigate } from "react-router";

import type { Project } from "@/dataCatalog";

import { ThemeToggle } from "../../../../app/theme/ThemeToggle";
import styles from "./OrgView.module.css";
import { ProjectGrid } from "./ProjectGrid";

export interface OrgSheetProps {
  projects: Project[];
  orgName: string | null;
  onClose: () => void;
}

export function OrgSheet({ projects, onClose }: OrgSheetProps): JSX.Element {
  const navigate = useNavigate();

  const selectProject = (projectId: string) => {
    onClose();
    navigate(`/projects/${projectId}/pipeline`);
  };

  return (
    <div
      className={styles.sheetBackdrop}
      data-testid="org-sheet-backdrop"
      onClick={onClose}
    >
      <div
        className={styles.sheet}
        data-testid="org-sheet"
        onClick={(event) => event.stopPropagation()}
      >
        <header className={styles.sheetHeader}>
          <div className={styles.appearance}>
            <span className={styles.appearanceLabel}>Appearance</span>
            <ThemeToggle />
          </div>
          <button
            type="button"
            className={styles.sheetClose}
            data-testid="org-sheet-close"
            aria-label="Close org settings"
            onClick={onClose}
          >
            Close
          </button>
        </header>
        <ProjectGrid projects={projects} onSelect={selectProject} />
      </div>
    </div>
  );
}

export default OrgSheet;
