import type { ToolCall } from "@/table-tools";
export type { TableSchema } from "@/chat/types";

export type MessageWidget = { type: "upload" };

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
  isStreaming?: boolean;
  widget?: MessageWidget;
}

export interface SSEMessage {
  type: "content" | "tool_calls" | "done" | "error";
  content?: string;
  tool_calls?: ToolCall[];
  error?: string;
}
