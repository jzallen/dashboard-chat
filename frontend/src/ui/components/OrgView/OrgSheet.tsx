// Org Settings sheet — RED scaffold (created by DISTILL, MR-3).
//
// Rendered by AppShell when the breadcrumb's org icon toggles the `?org=1` search
// param. A darker inset backdrop hosts the existing org settings surface (the MR-1
// Appearance / dark-mode ThemeToggle plus the project grid). Clicking the backdrop
// or the close control clears the param. path-forward §4.1 / §4.2.
import type { Project } from "@/dataCatalog";

export const __SCAFFOLD__ = true;

export interface OrgSheetProps {
  projects: Project[];
  orgName: string | null;
  onClose: () => void;
}

export function OrgSheet(_props: OrgSheetProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (breadcrumb MR-3)");
}

export default OrgSheet;
