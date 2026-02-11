/**
 * Sessions API — chat session lifecycle and turn logging
 */

import { get, post } from "./client";

export interface ChatTurnPayload {
  user_message: string;
  system_prompt: string;
  tool_definitions: object[];
  assistant_content: string;
  tool_calls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> | null;
  tool_results: Array<{ tool_call_id: string; result: string }> | null;
  table_schema: object;
}

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
  dataset_id: string | null;
  turns: ChatTurn[];
  created_at: string;
  updated_at: string;
}

export interface ChatSessionSummary {
  id: string;
  dataset_id: string | null;
  turns: ChatTurn[];
  created_at: string;
  updated_at: string;
}

export async function createSession(datasetId?: string): Promise<ChatSession> {
  return post<ChatSession>("/api/sessions", { dataset_id: datasetId ?? null });
}

export async function logTurn(sessionId: string, turn: ChatTurnPayload): Promise<void> {
  await post(`/api/sessions/${sessionId}/turns`, turn);
}

export async function getSession(sessionId: string): Promise<ChatSession> {
  return get<ChatSession>(`/api/sessions/${sessionId}`);
}

export async function listSessions(datasetId: string): Promise<ChatSessionSummary[]> {
  return get<ChatSessionSummary[]>(`/api/datasets/${datasetId}/sessions`);
}
