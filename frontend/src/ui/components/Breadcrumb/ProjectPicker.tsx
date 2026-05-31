// Searchable project picker popover — RED scaffold (created by DISTILL, MR-3).
//
// Opened from the breadcrumb's `Project ▾` crumb. Renders a search box that
// filters the org's projects by name (case-insensitive); selecting a project
// navigates to the MR-2 Pipeline landing (`projects/:projectId/pipeline`). Data
// comes from the existing org-projects query hook (NOT ui-state). path-forward §4.1.
import type { Project } from "@/dataCatalog";

export const __SCAFFOLD__ = true;

export interface ProjectPickerProps {
  projects: Project[];
  currentProjectId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectPicker(_props: ProjectPickerProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (breadcrumb MR-3)");
}

export default ProjectPicker;
