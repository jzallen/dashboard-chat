export interface SessionMetadata {
  session_id: string;
  project_id: string;
  dataset_id: string;
  created_at: string;
}

export interface TurnRecord {
  turn_id: string;
  sequence: number;
  user_message: string;
  system_prompt: string;
  tool_definitions: object[];
  assistant_content: string | null;
  tool_calls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> | null;
  tool_results: Array<{ tool_call_id: string; result: string }> | null;
  table_schema: object;
  created_at: string;
}

// JSONL event types
export interface SessionStartEvent {
  event: "session_start";
  session_id: string;
  project_id: string;
  dataset_id: string;
  created_at: string;
}

export interface TurnEvent {
  event: "turn";
  sequence: number;
  turn_id: string;
  user_message: string;
  system_prompt: string;
  tool_definitions: object[];
  assistant_content: string | null;
  tool_calls: object[] | null;
  tool_results: object[] | null;
  table_schema: object;
  created_at: string;
}

export type SessionEvent = SessionStartEvent | TurnEvent;

// API request types
export interface CreateSessionRequest {
  project_id: string;
  dataset_id: string;
}

export interface LogTurnRequest {
  user_message: string;
  system_prompt: string;
  tool_definitions: object[];
  assistant_content: string | null;
  tool_calls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> | null;
  tool_results: Array<{ tool_call_id: string; result: string }> | null;
  table_schema: object;
}

// API response types (matching existing frontend types)
export interface ChatTurn {
  id: string;
  session_id: string;
  sequence: number;
  user_message: string;
  system_prompt: string;
  tool_definitions: object[];
  assistant_content: string | null;
  tool_calls: object[] | null;
  tool_results: object[] | null;
  table_schema: object;
  created_at: string;
}

export interface ChatSession {
  id: string;
  project_id: string;
  dataset_id: string | null;
  turns: ChatTurn[];
  created_at: string;
  updated_at: string;
}
