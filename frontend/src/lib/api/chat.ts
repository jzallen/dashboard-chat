/**
 * Chat Worker API Client
 *
 * Dedicated client for all communication with the chat worker service.
 * Session CRUD uses ApiClient, SSE streaming uses withEagerAuth directly.
 */

import type { TableSchema, ToolCall, ToolDefinition } from "@/chat/types";

import { withEagerAuth } from "../auth/withAuth";
import { ApiClient } from "./client";
import { CHAT_URL } from "./config";

const chatClient = new ApiClient(CHAT_URL, { unwrapData: false });

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
  return chatClient.post<ChatSession>("/sessions", {
    project_id: projectId,
    dataset_id: datasetId ?? null,
  });
}

export async function logTurn(sessionId: string, turn: ChatTurnPayload): Promise<void> {
  await chatClient.post<void>(`/sessions/${sessionId}/turns`, turn);
}

export async function getSession(sessionId: string): Promise<ChatSession> {
  return chatClient.get<ChatSession>(`/sessions/${sessionId}`);
}

export async function listSessions(datasetId: string): Promise<ChatSession[]> {
  return chatClient.get<ChatSession[]>(`/sessions?dataset_id=${encodeURIComponent(datasetId)}`);
}

/** Builds and sends the chat SSE request with eager auth refresh. */
export async function fetchChatStream(
  apiMessages: Array<{ role: string; content: string; tool_calls?: ToolCall[] }>,
  tableSchema: TableSchema | null,
): Promise<Response> {
  const eagerAuthedFetch = withEagerAuth((...args: Parameters<typeof fetch>) => fetch(...args));
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
