// AssistantControls — overlay-internal session controls (MR-4).
//
// RED scaffold (created by DISTILL). These are the controls MR-3 deferred out of
// the breadcrumb (DWD-M3-4): New Session (+) resets the chat session and returns to
// the index; history (clock) navigates to All Chats (/sessions); recent-chat chips
// come from the existing useSessions hook (the same listSessions port SessionList /
// UnifiedNav use) and deep-link to /chat/:id. The ui-state wire is NOT touched.
import type { Project } from "@/dataCatalog";

export const __SCAFFOLD__ = true;

export interface AssistantControlsProps {
  projects: Project[] | null;
}

export function AssistantControls(_props: AssistantControlsProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (Assistant MR-4)");
}

export default AssistantControls;
