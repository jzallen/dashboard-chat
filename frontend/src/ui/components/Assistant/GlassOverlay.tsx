// GlassOverlay — the LIGHT-mode assistant surface (MR-4).
//
// A bottom-anchored glass/comic overlay (rounded ink panel — path-forward §2.4 / §9)
// that wraps the shared AssistantControls + AssistantFeed. The dark-mode counterpart
// is TerminalAssistant; both render the SAME feed off the existing chat context.
import styles from "./Assistant.module.css";
import { AssistantControls } from "./AssistantControls";
import { AssistantFeed } from "./AssistantFeed";
import type { AssistantSurfaceProps } from "./types";

export type { AssistantSurfaceProps };

export function GlassOverlay({ projects, onClose }: AssistantSurfaceProps): JSX.Element {
  return (
    <section
      className={`${styles.surface} ${styles.glass}`}
      data-testid="assistant-glass"
      aria-label="Assistant"
    >
      <div className={styles.header}>
        <span className={styles.title}>Assistant</span>
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

export default GlassOverlay;
