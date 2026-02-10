import { useState, type RefObject, type Dispatch, type SetStateAction, type FormEvent } from "react";
import type { Message } from "../../types";
import type { Dataset } from "@/api";
import { MessageBubble } from "./MessageBubble";
import { ChatEmptyState } from "./ChatEmptyState";
import styles from "./ChatPanel.module.css";

interface ChatPanelProps {
  messages: Message[];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  handleSubmit: (e: FormEvent) => void;
  inputRef: RefObject<HTMLInputElement>;
  chatEndRef: RefObject<HTMLDivElement>;
  onAction?: (action: string) => void;
  projectId?: string;
  onUploadComplete?: (dataset: Dataset) => void;
  onUploadError?: (error: string) => void;
}

export default function ChatPanel({
  messages,
  input,
  setInput,
  isLoading,
  handleSubmit,
  inputRef,
  chatEndRef,
  onAction,
  projectId,
  onUploadComplete,
  onUploadError,
}: ChatPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <h2 className={styles.headerTitle}>Chat</h2>
        <p className={styles.headerHint}>
          Try: "Show items with amount greater than 50"
        </p>
      </div>

      <div className={styles.messagesArea}>
        {messages.length === 0 && <ChatEmptyState />}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            projectId={projectId}
            onUploadComplete={onUploadComplete}
            onUploadError={onUploadError}
          />
        ))}
        <div ref={chatEndRef} />
      </div>

      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <div className={styles.inputWrapper}>
          {onAction && (
            <div className={styles.actionMenuWrapper}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                className={styles.actionButton}
                aria-label="Actions"
              >
                +
              </button>
              {menuOpen && (
                <div className={styles.actionMenu}>
                  <button
                    type="button"
                    className={styles.actionMenuItem}
                    onClick={() => {
                      onAction("create-dataset");
                      setMenuOpen(false);
                    }}
                  >
                    Create Dataset
                  </button>
                </div>
              )}
            </div>
          )}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command..."
            className={styles.input}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className={styles.submitButton}
          >
            {isLoading ? "..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
