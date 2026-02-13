/**
 * Sessions API — chat session lifecycle and turn logging
 *
 * Talks directly to the chat worker (not the backend API).
 */

import { getAuthHeaders, handleResponse } from "./fetchUtils";
import { CHAT_URL } from "../ui/data/config";

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
  project_id: string;
  dataset_id: string | null;
  turns: ChatTurn[];
  created_at: string;
  updated_at: string;
}

export async function createSession(projectId: string, datasetId?: string): Promise<ChatSession> {
  const response = await fetch(`${CHAT_URL}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ project_id: projectId, dataset_id: datasetId ?? null }),
  });
  return handleResponse<ChatSession>(response);
}

export async function logTurn(sessionId: string, turn: ChatTurnPayload): Promise<void> {
  const response = await fetch(`${CHAT_URL}/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(turn),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to log turn (${response.status}): ${text}`);
  }
}

export async function getSession(sessionId: string): Promise<ChatSession> {
  const response = await fetch(`${CHAT_URL}/sessions/${sessionId}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<ChatSession>(response);
}

export async function listSessions(datasetId: string): Promise<ChatSession[]> {
  const response = await fetch(`${CHAT_URL}/sessions?dataset_id=${encodeURIComponent(datasetId)}`, {
    headers: getAuthHeaders(),
  });
  return handleResponse<ChatSession[]>(response);
}
