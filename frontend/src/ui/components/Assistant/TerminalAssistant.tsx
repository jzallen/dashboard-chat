// TerminalAssistant — the DARK-mode assistant surface (MR-4).
//
// RED scaffold (created by DISTILL). In dark mode (Solarized-dark) the assistant is
// a docked console / TUI terminal instead of the glass/comic overlay
// (path-forward §2.4 / §9), rendering the SAME shared AssistantControls +
// AssistantFeed off the existing chat context. The render branch is selected in
// Assistant/index.tsx off the reactive dark flag (useIsDark).
import type { AssistantSurfaceProps } from "./GlassOverlay";

export const __SCAFFOLD__ = true;

export function TerminalAssistant(_props: AssistantSurfaceProps): JSX.Element {
  throw new Error("Not yet implemented — RED scaffold (Assistant MR-4)");
}

export default TerminalAssistant;
