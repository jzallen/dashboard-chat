import type { ToolCall } from "../types";

export interface MessageContent {
  type: "text" | "image" | "input_text" | "input_file";
  text?: string;
  data?: unknown;
  mimeType?: string;
}

export interface Message {
  id?: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | MessageContent[];
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  createdAt?: Date;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  parameters: object;
  returnType?: unknown;
  isAsync?: boolean;
}

export interface TableSchema {
  columns: Array<{
    id: string;
    type: "string" | "number" | "boolean" | "date";
  }>;
  rowCount: number;
}
