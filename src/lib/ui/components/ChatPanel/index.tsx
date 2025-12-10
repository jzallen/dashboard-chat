import type { RefObject, Dispatch, SetStateAction, FormEvent } from "react";
import type { Message } from "../../types";
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
}

export default function ChatPanel({
  messages,
  input,
  setInput,
  isLoading,
  handleSubmit,
  inputRef,
  chatEndRef,
}: ChatPanelProps) {
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
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={chatEndRef} />
      </div>

      <form onSubmit={handleSubmit} className={styles.inputForm}>
        <div className={styles.inputWrapper}>
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
