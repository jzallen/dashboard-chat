import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useRef } from "react";

import styles from "./chat.module.css";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  isLoading: boolean;
  datasetName?: string;
  onClearDataset?: () => void;
  contextType?: "dataset" | "view" | "report" | null;
  contextLabel?: string;
  onClearContext?: () => void;
}

export function ChatInput({ input, setInput, onSubmit, isLoading, datasetName, onClearDataset, contextType, contextLabel, onClearContext }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() && !isLoading) {
        onSubmit(e as unknown as FormEvent);
      }
    }
  };

  return (
    <form onSubmit={onSubmit} className={styles.chatInputForm}>
      <div className={styles.chatInputWrapper}>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          className={styles.chatTextarea}
          disabled={isLoading}
          rows={1}
          data-testid="chat-input"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className={styles.chatSubmitButton}
        >
          {isLoading ? "..." : "Send"}
        </button>
      </div>
      {(datasetName || contextLabel) && (
        <div className={styles.chatInputGutter}>
          <span className={styles.chatInputDatasetName}>
            {contextLabel
              ? `${contextType === "view" ? "View" : "Dataset"} / ${contextLabel}`
              : datasetName}
          </span>
          {(onClearContext || onClearDataset) && (
            <button
              type="button"
              className={styles.chatInputClearDataset}
              onClick={onClearContext ?? onClearDataset}
              title="Clear context"
            >
              ×
            </button>
          )}
        </div>
      )}
    </form>
  );
}
