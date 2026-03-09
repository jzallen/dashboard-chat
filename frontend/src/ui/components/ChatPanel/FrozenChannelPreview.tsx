import type { ChannelPreviewUIComponentProps } from "stream-chat-react";

import styles from "./ChatPanel.module.css";

/**
 * Custom channel preview that visually distinguishes frozen sessions
 * with a lock icon and muted style.
 */
export function FrozenChannelPreview(props: ChannelPreviewUIComponentProps) {
  const { channel, displayTitle, active, setActiveChannel, latestMessage } = props;
  const isFrozen = !!(channel.data as Record<string, unknown>)?.frozenAt;

  return (
    <button
      type="button"
      className={`${styles.channelPreview} ${active ? styles.channelPreviewActive : ""} ${isFrozen ? styles.channelPreviewFrozen : ""}`}
      onClick={() => setActiveChannel?.(channel)}
    >
      <span className={styles.channelPreviewTitle}>
        {isFrozen && <span className={styles.channelPreviewLock}>&#128274; </span>}
        {displayTitle || "Session"}
      </span>
      {latestMessage && (
        <span className={styles.channelPreviewMessage}>
          {typeof latestMessage === "string" ? latestMessage : ""}
        </span>
      )}
    </button>
  );
}
