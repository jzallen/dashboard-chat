// Shared prop types for the assistant surfaces (MR-4).
import type { Project } from "@/dataCatalog";

/** Common props for the two assistant surfaces (GlassOverlay / TerminalAssistant).
 *  `projects` feeds the recents project scope; `onClose` collapses the surface. */
export interface AssistantSurfaceProps {
  projects: Project[] | null;
  onClose: () => void;
}
