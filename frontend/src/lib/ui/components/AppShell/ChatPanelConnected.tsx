import { useChatContext } from "../../context/ChatContext";
import ChatPanel from "../ChatPanel";

export function ChatPanelConnected() {
  const {
    messages,
    input,
    setInput,
    isLoading,
    handleSubmit,
    inputRef,
    chatEndRef,
    isActive,
  } = useChatContext();

  return (
    <ChatPanel
      messages={messages}
      input={isActive ? input : ""}
      setInput={setInput}
      isLoading={isLoading || !isActive}
      handleSubmit={handleSubmit}
      inputRef={inputRef}
      chatEndRef={chatEndRef}
    />
  );
}
