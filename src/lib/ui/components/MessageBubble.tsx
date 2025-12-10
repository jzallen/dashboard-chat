import type { Message } from "../types";

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <div
      className={`flex ${
        message.role === "user" ? "justify-end" : "justify-start"
      }`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          message.role === "user"
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-800"
        }`}
      >
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        {message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200 text-xs text-gray-600">
            {message.tool_calls.map((tc) => (
              <div key={tc.id} className="flex items-center gap-1">
                <span className="text-green-600">✓</span>
                <span>{tc.function.name}</span>
              </div>
            ))}
          </div>
        )}
        {message.isStreaming && (
          <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse ml-1" />
        )}
      </div>
    </div>
  );
}
