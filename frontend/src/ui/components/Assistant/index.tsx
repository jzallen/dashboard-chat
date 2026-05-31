// Assistant — shell-level FAB + glass overlay (light) / docked TUI terminal (dark).
//
// RED scaffold (created by DISTILL). Mounts in AppShell as a sibling of <Outlet/>
// (path-forward §4.4) so it floats over every view. A bottom-right FAB toggles the
// assistant open/closed; when open the render branch is `dark ? <TerminalAssistant/>
// : <GlassOverlay/>` off the reactive dark flag (useIsDark) — both render the SAME
// chat feed from the EXISTING ChatProvider/StreamProvider context (the ui-state wire
// is untouched). The FAB hides while the org settings sheet is open (?org=1) so it
// does not overlap the sheet (path-forward §4.1).
import type { Project } from "@/dataCatalog";

export const __SCAFFOLD__ = true;

export interface AssistantProps {
  projects: Project[] | null;
}

export function Assistant(_props: AssistantProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (Assistant MR-4)");
}

export default Assistant;
