import type { Message } from "../../types";
import styles from "./ChatPanel.module.css";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={`${styles.messageRow} ${isUser ? styles.messageRowUser : styles.messageRowAssistant}`}
    >
      <div
        className={`${styles.messageBubble} ${isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant}`}
      >
        <p className={styles.messageContent}>{message.content}</p>
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className={styles.toolCalls}>
            {message.tool_calls.map((tc) => (
              <div key={tc.id} className={styles.toolCall}>
                <span className={styles.toolCallIcon}>✓</span>
                <span>{tc.function.name}</span>
              </div>
            ))}
          </div>
        )}
        {message.isStreaming && <span className={styles.streamingCursor} />}
      </div>
    </div>
  );
}
