import { useEffect, useState } from "react";

import { formatRelativeTime } from "../../../lib/ui/utils/formatRelativeTime";
import type { Message } from "../../types";
import styles from "./TableView.module.css";

interface ActivityLogProps {
  messages: Message[];
  isStreaming: boolean;
  streamingContent: string;
}

/** Semi-transparent overlay showing recent chat messages on the table view. */
export function ActivityLog({ messages, isStreaming, streamingContent }: ActivityLogProps) {
  const [visible, setVisible] = useState(false);
  const [lastMessageCount, setLastMessageCount] = useState(0);

  useEffect(() => {
    if (messages.length > lastMessageCount) {
      setVisible(true);
      setLastMessageCount(messages.length);
    }
  }, [messages.length, lastMessageCount]);

  useEffect(() => {
    if (!visible || isStreaming) return;
    const timer = setTimeout(() => setVisible(false), 5000);
    return () => clearTimeout(timer);
  }, [visible, isStreaming, messages.length]);

  const recentMessages = messages.slice(-3);

  if (!visible && !isStreaming) return null;

  return (
    <div className={styles.activityLog} data-testid="activity-log">
      {recentMessages.map((m) => (
        <div key={m.id} className={styles.activityMessage}>
          <span className={styles.activityRole}>{m.role === "user" ? "You" : "AI"}</span>
          {m.timestamp && (
            <span className={styles.activityTimestamp}>{formatRelativeTime(new Date(m.timestamp))}</span>
          )}
          <span className={styles.activityContent}>
            {m.content.length > 120 ? `${m.content.slice(0, 120)}...` : m.content}
          </span>
        </div>
      ))}
      {isStreaming && streamingContent && (
        <div className={styles.activityMessage}>
          <span className={styles.activityRole}>AI</span>
          <span className={styles.activityContent}>
            {streamingContent.length > 120 ? `${streamingContent.slice(0, 120)}...` : streamingContent}
            <span className={styles.streamingDot} />
          </span>
        </div>
      )}
    </div>
  );
}
