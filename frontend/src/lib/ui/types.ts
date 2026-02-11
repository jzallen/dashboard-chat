import type { ToolCall } from "@/table-tools";

export type MessageWidget = { type: "upload" };

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  tool_calls?: ToolCall[];
  isStreaming?: boolean;
  widget?: MessageWidget;
}

export interface TableSchema {
  columns: Array<{ id: string; type: "string" | "number" | "boolean" }>;
  rowCount: number;
  activeFilters?: Array<{ column: string; operator: string; value: unknown }>;
}

export interface SSEMessage {
  type: "content" | "tool_calls" | "done" | "error";
  content?: string;
  tool_calls?: ToolCall[];
  error?: string;
}
