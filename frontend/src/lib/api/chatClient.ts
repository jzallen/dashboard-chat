/**
 * Chat Worker API Client
 *
 * Dedicated client for all communication with the chat worker service.
 * Session CRUD uses withAuth, SSE streaming uses withEagerAuth.
 */

import type { TableSchema, ToolCall, ToolDefinition } from "@/chat/types";

import { withAuth, withEagerAuth } from "../auth/withAuth";
import { CHAT_URL } from "./config";

const authedFetch = withAuth((...args: Parameters<typeof fetch>) => fetch(...args));
const eagerAuthedFetch = withEagerAuth((...args: Parameters<typeof fetch>) => fetch(...args));

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
  const response = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id: projectId, dataset_id: datasetId ?? null }),
  });
  if (response.status === 401) throw new Error("Session expired");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function logTurn(sessionId: string, turn: ChatTurnPayload): Promise<void> {
  const url = `${CHAT_URL}/sessions/${sessionId}/turns`;
  const response = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(turn),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to log turn (${response.status}): ${text}`);
  }
}

export async function getSession(sessionId: string): Promise<ChatSession> {
  const url = `${CHAT_URL}/sessions/${sessionId}`;
  const response = await authedFetch(url, {});
  if (response.status === 401) throw new Error("Session expired");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
  return response.json();
}

export async function listSessions(datasetId: string): Promise<ChatSession[]> {
  const url = `${CHAT_URL}/sessions?dataset_id=${encodeURIComponent(datasetId)}`;
  const response = await authedFetch(url, {});
  if (response.status === 401) throw new Error("Session expired");
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Request failed (${response.status}): ${text}`);
  }
  return response.json();
}

/** Builds and sends the chat SSE request with eager auth refresh. */
export async function fetchChatStream(
  apiMessages: Array<{ role: string; content: string; tool_calls?: ToolCall[] }>,
  tableSchema: TableSchema | null,
): Promise<Response> {
  const response = await eagerAuthedFetch(`${CHAT_URL}/chat`, {
    method: "POST",
    mode: "cors",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: apiMessages, tableSchema }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.body) throw new Error("No response body");
  return response;
}
