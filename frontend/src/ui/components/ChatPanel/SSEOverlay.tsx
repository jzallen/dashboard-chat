import styles from "./ChatPanel.module.css";

interface SSEOverlayProps {
  content: string;
}

/**
 * Simple overlay component showing streaming text with a cursor animation.
 * Positioned below the message list during active SSE turns.
 */
export function SSEOverlay({ content }: SSEOverlayProps) {
  return (
    <div className={`${styles.messageRow} ${styles.messageRowAssistant}`}>
      <div className={`${styles.messageBubble} ${styles.messageBubbleAssistant}`}>
        <p className={styles.messageContent}>
          {content}
          <span className={styles.streamingCursor} />
        </p>
      </div>
    </div>
  );
}
