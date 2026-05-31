// AssistantFeed — the shared chat feed for the assistant overlay/terminal (MR-4).
//
// A pure presentation reshell: it consumes the EXISTING ChatProvider context
// (messages / input / handleSubmit / isLoading / chatEndRef) and reuses the existing
// MessageList + ChatInput. Both the light glass overlay and the dark TUI terminal
// render THIS same feed, so the chat wire / ui-state transport is untouched
// (saved-feedback constraint, path-forward §4.4).
import { useChatContext } from "../../context/ChatContext";
import { ChatInput, MessageList } from "../chat";
import styles from "./Assistant.module.css";

export function AssistantFeed(): JSX.Element {
  const { messages, input, setInput, isLoading, handleSubmit, chatEndRef } =
    useChatContext();

  return (
    <div className={styles.feed} data-testid="assistant-feed">
      {messages.length === 0 ? (
        <div className={styles.empty} data-testid="assistant-empty">
          Ask the assistant anything about your pipeline.
        </div>
      ) : (
        <MessageList messages={messages} chatEndRef={chatEndRef} />
      )}
      <ChatInput
        input={input}
        setInput={setInput}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  );
}

export default AssistantFeed;
