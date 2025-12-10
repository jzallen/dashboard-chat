import type { ToolCall } from "../table-tools";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
  isStreaming?: boolean;
}

export interface TableSchema {
  columns: Array<{ id: string; type: "string" | "number" | "boolean" }>;
  rowCount: number;
}

export interface SSEMessage {
  type: "content" | "tool_calls" | "done" | "error";
  content?: string;
  tool_calls?: ToolCall[];
  error?: string;
}
