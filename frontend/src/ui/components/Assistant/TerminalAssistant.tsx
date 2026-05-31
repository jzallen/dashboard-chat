// TerminalAssistant — the DARK-mode assistant surface (MR-4).
//
// In dark mode (Solarized-dark) the assistant is a docked console / TUI terminal
// instead of the glass/comic overlay (path-forward §2.4 / §9), rendering the SAME
// shared AssistantControls + AssistantFeed off the existing chat context. The render
// branch is selected in Assistant/index.tsx off the reactive dark flag (useIsDark).
import styles from "./Assistant.module.css";
import { AssistantControls } from "./AssistantControls";
import { AssistantFeed } from "./AssistantFeed";
import type { AssistantSurfaceProps } from "./types";

export function TerminalAssistant({
  projects,
  onClose,
}: AssistantSurfaceProps): JSX.Element {
  return (
    <section
      className={`${styles.surface} ${styles.terminal}`}
      data-testid="assistant-terminal"
      aria-label="Assistant terminal"
    >
      <div className={styles.header}>
        <span className={styles.title}>~/assistant</span>
        <button
          type="button"
          data-testid="assistant-close"
          className={styles.closeBtn}
          aria-label="Close assistant"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <AssistantControls projects={projects} />
      <AssistantFeed />
    </section>
  );
}

export default TerminalAssistant;
