export const CASE_OPERATIONS = ["upper", "lower", "title", "snake", "kebab"] as const;

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

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

export interface SSEMessage {
  type: "content" | "tool_calls" | "done" | "error";
  content?: string;
  tool_calls?: ToolCall[];
  error?: string;
}

export interface TableSchema {
  columns: Array<{
    id: string;
    type: "string" | "number" | "boolean" | "date";
    alias?: string;
    profile?: {
      type: string;
      unique_count?: number;
      sample_values?: string[];
      min?: number | string;
      max?: number | string;
      mean?: number;
      true_count?: number;
      false_count?: number;
      null_count?: number;
    };
  }>;
  rowCount: number;
  activeFilters?: Array<{ column: string; operator: string; value: unknown }>;
  activeCleaningTransforms?: Array<{
    id: string;
    column: string;
    operation: string;
    details?: string;
  }>;
  formatContext?: string;
}
