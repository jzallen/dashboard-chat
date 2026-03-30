import type { ToolCall } from "@/toolCalls";
export type { SSEMessage, TableSchema } from "@/chat/types";

export type MessageWidget =
  | { type: "upload" }
  | { type: "dataset-picker" }
  | { type: "file-upload"; projectId: string };

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
  isStreaming?: boolean;
  widget?: MessageWidget;
  timestamp?: number;
}
