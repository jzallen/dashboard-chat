import { type Dispatch, type FormEvent, memo, type RefObject, type SetStateAction, useState } from "react";

import type { Dataset } from "@/dataCatalog";

import type { Message } from "../../types";
import { ChatEmptyState } from "./ChatEmptyState";
import styles from "./ChatPanel.module.css";
import { LayerBadge } from "./LayerBadge";
import { MessageBubble } from "./MessageBubble";

/** Props for the ChatPanel component. */
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
  activeLayer?: string;
  activeModelName?: string;
}

/** Chat interface with message history, input field, and upload support. */
function ChatPanel({
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
  activeLayer,
  activeModelName,
}: ChatPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h2 className={styles.headerTitle}>Chat</h2>
          {activeLayer && activeModelName && (
            <LayerBadge layer={activeLayer} modelName={activeModelName} />
          )}
        </div>
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
                <div className={styles.actionMenu} data-testid="chat-action-menu">
                  <button
                    type="button"
                    className={styles.actionMenuItem}
                    onClick={() => {
                      onAction("new-session");
                      setMenuOpen(false);
                    }}
                  >
                    New Session
                  </button>
                  <button
                    type="button"
                    className={styles.actionMenuItem}
                    data-testid="action-create-dataset"
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

export default memo(ChatPanel);
