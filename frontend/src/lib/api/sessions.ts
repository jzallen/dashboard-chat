/**
 * Sessions API — chat session lifecycle and turn logging
 *
 * Talks directly to the chat worker (not the backend API).
 */

import type { TableSchema, ToolCall, ToolDefinition } from "@/chat/types";

import { CHAT_URL } from "../ui/data/config";
import { getAuthHeaders, handleResponse, withAuthRetry } from "./fetchUtils";

export interface ToolResult {
  tool_call_id: string;
  result: string;
}

export interface ChatTurnPayload {
  user_message: string;
  system_prompt: string;
  tool_definitions: ToolDefinition[];
  assistant_content: string;
  tool_calls: ToolCall[] | null;
  tool_results: ToolResult[] | null;
  table_schema: TableSchema;
}

export interface ChatTurn {
  id: string;
  session_id: string;
  sequence: number;
  user_message: string;
  system_prompt: string;
  tool_definitions: ToolDefinition[];
  assistant_content: string | null;
  tool_calls: ToolCall[] | null;
  tool_results: ToolResult[] | null;
  table_schema: TableSchema;
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
  const url = `${CHAT_URL}/sessions`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify({ project_id: projectId, dataset_id: datasetId ?? null }),
  };
  const response = await fetch(url, init);
  return handleResponse<ChatSession>(response, url, init);
}

export async function logTurn(sessionId: string, turn: ChatTurnPayload): Promise<void> {
  const url = `${CHAT_URL}/sessions/${sessionId}/turns`;
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
    body: JSON.stringify(turn),
  };
  let response = await fetch(url, init);
  response = await withAuthRetry(response, url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to log turn (${response.status}): ${text}`);
  }
}

export async function getSession(sessionId: string): Promise<ChatSession> {
  const url = `${CHAT_URL}/sessions/${sessionId}`;
  const init: RequestInit = {
    headers: getAuthHeaders(),
  };
  const response = await fetch(url, init);
  return handleResponse<ChatSession>(response, url, init);
}

export async function listSessions(datasetId: string): Promise<ChatSession[]> {
  const url = `${CHAT_URL}/sessions?dataset_id=${encodeURIComponent(datasetId)}`;
  const init: RequestInit = {
    headers: getAuthHeaders(),
  };
  const response = await fetch(url, init);
  return handleResponse<ChatSession[]>(response, url, init);
}
