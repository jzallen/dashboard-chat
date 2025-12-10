import type { RefObject, Dispatch, SetStateAction, FormEvent } from "react";
import type { Message } from "../types";
import { MessageBubble } from "./MessageBubble";
import { ChatEmptyState } from "./ChatEmptyState";

interface ChatPanelProps {
  messages: Message[];
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  isLoading: boolean;
  handleSubmit: (e: FormEvent) => void;
  inputRef: RefObject<HTMLInputElement>;
  chatEndRef: RefObject<HTMLDivElement>;
}

export function ChatPanel({
  messages,
  input,
  setInput,
  isLoading,
  handleSubmit,
  inputRef,
  chatEndRef,
}: ChatPanelProps) {
  return (
    <div className="w-96 border-l border-gray-200 flex flex-col bg-white">
      <div className="p-4 border-b border-gray-200">
        <h2 className="font-semibold text-gray-800">Chat</h2>
        <p className="text-xs text-gray-500 mt-1">
          Try: "Show items with amount greater than 50"
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 && <ChatEmptyState />}

        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        <div ref={chatEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="p-4 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a command..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700"
          >
            {isLoading ? "..." : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
