import { useNavigate } from "react-router-dom";

import { useChatContext } from "../../context/ChatContext";
import type { Message } from "../../types";
import styles from "./chat.module.css";
import { DatasetPicker } from "./DatasetPicker";
import { ProjectPicker } from "./ProjectPicker";

interface MessageBubbleProps {
  message: Message;
  isStreaming: boolean;
}

export function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const { handleDatasetSelected } = useChatContext();
  const navigate = useNavigate();

  return (
    <div className={`${styles.messageRow} ${isUser ? styles.messageRowUser : styles.messageRowAssistant}`}>
      <div className={`${styles.messageBubble} ${isUser ? styles.messageBubbleUser : styles.messageBubbleAssistant}`}>
        <p className={styles.messageContent}>{message.content}</p>
        {message.widget?.type === "dataset-picker" && (
          <DatasetPicker onSelect={handleDatasetSelected} />
        )}
        {message.widget?.type === "upload" && (
          <ProjectPicker onSelect={(projectId) => navigate(`/projects/${projectId}`)} />
        )}
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className={styles.toolCalls}>
            {message.tool_calls.map((tc) => (
              <div key={tc.id} className={styles.toolCall}>
                <span className={styles.toolCallIcon}>&#10003;</span>
                <span>{tc.function.name}</span>
              </div>
            ))}
          </div>
        )}
        {isStreaming && <span className={styles.streamingCursor} />}
      </div>
    </div>
  );
}
