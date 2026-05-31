// GlassOverlay — the LIGHT-mode assistant surface (MR-4).
//
// RED scaffold (created by DISTILL). A bottom-anchored glass/comic overlay (rounded
// ink panel — path-forward §2.4 / §9) that wraps the shared AssistantControls +
// AssistantFeed. The dark-mode counterpart is TerminalAssistant; both render the
// SAME feed off the existing chat context.
import type { Project } from "@/dataCatalog";

export const __SCAFFOLD__ = true;

export interface AssistantSurfaceProps {
  projects: Project[] | null;
  onClose: () => void;
}

export function GlassOverlay(_props: AssistantSurfaceProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (Assistant MR-4)");
}

export default GlassOverlay;
