import { type Dispatch, type FormEvent, memo, type RefObject, type SetStateAction, useState } from "react";
import type { Channel as StreamChannel } from "stream-chat";
import { Channel, ChannelList, MessageInput, MessageList } from "stream-chat-react";

import type { Dataset } from "@/dataCatalog";

import { useStreamContext } from "@/stream/StreamProvider";
import type { Message } from "../../types";
import { OperationsLog } from "../TablePanel/OperationsLog";
import styles from "./ChatPanel.module.css";
import { FrozenChannelPreview } from "./FrozenChannelPreview";
import { LayerBadge } from "./LayerBadge";
import { SSEOverlay } from "./SSEOverlay";

/** Props for the ChatPanel component. */
interface ChatPanelProps {
  messages: Message[];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  handleSubmit: (e: FormEvent) => void;
  handleStreamSubmit?: (text: string) => void;
  inputRef: RefObject<HTMLInputElement>;
  chatEndRef: RefObject<HTMLDivElement>;
  onAction?: (action: string) => void;
  projectId?: string;
  onUploadComplete?: (dataset: Dataset) => void;
  onUploadError?: (error: string) => void;
  activeLayer?: string;
  activeModelName?: string;
  isStreaming?: boolean;
  streamingContent?: string;
  isFrozen?: boolean;
  channel?: StreamChannel | null;
}

/** Chat interface using Stream SDK primitives with SSE overlay for streaming. */
function ChatPanel({
  messages,
  input,
  setInput,
  isLoading,
  handleSubmit,
  handleStreamSubmit,
  inputRef,
  chatEndRef,
  onAction,
  projectId,
  onUploadComplete,
  onUploadError,
  activeLayer,
  activeModelName,
  isStreaming,
  streamingContent,
  isFrozen,
  channel,
}: ChatPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isReady } = useStreamContext();

  // Stream SDK mode — render Stream primitives
  if (isReady && projectId) {
    const channelFilter = {
      type: "messaging" as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "custom.projectId": projectId as any,
    };
    const channelSort = [{ last_message_at: -1 as const }];

    return (
      <div className={styles.panel}>
        <div className={styles.header}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <h2 className={styles.headerTitle}>Chat</h2>
            {activeLayer && activeModelName && (
              <LayerBadge layer={activeLayer} modelName={activeModelName} />
            )}
          </div>
        </div>

        <div className={styles.streamChannelList}>
          <ChannelList
            filters={channelFilter}
            sort={channelSort}
            Preview={FrozenChannelPreview}
          />
        </div>

        <Channel>
          <div className={styles.messagesArea}>
            <MessageList />
            {isStreaming && streamingContent && (
              <SSEOverlay content={streamingContent} />
            )}
            <div ref={chatEndRef} />
          </div>

          {isFrozen ? (
            <div className={styles.frozenBanner}>
              Session frozen — read-only
            </div>
          ) : (
            <MessageInput
              overrideSubmitHandler={(message) => {
                const text = message.text?.trim();
                if (text && handleStreamSubmit) {
                  handleStreamSubmit(text);
                }
              }}
            />
          )}
        </Channel>

        <OperationsLog channel={channel ?? null} />

        {onAction && (
          <div className={styles.inputForm}>
            <div className={styles.inputWrapper}>
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
            </div>
          </div>
        )}
      </div>
    );
  }

  // Fallback: original custom UI (Stream not configured or no project)
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
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            <p className={styles.emptyStateSubtitle}>
              Start a conversation to control the table
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`${styles.messageRow} ${message.role === "user" ? styles.messageRowUser : styles.messageRowAssistant}`}
          >
            <div
              className={`${styles.messageBubble} ${message.role === "user" ? styles.messageBubbleUser : styles.messageBubbleAssistant}`}
            >
              <p className={styles.messageContent}>{message.content}</p>
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
              {message.isStreaming && <span className={styles.streamingCursor} />}
            </div>
          </div>
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
