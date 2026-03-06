/**
 * Chat Worker API Client
 *
 * Factory-based client for all communication with the chat worker service.
 * Callers inject auth via fetchFn: createChatClient(withAuth(fetch)).
 */

import { ApiClient } from "@/http/apiClient";
import { CHAT_BASE_URL } from "@/http/config";

import type { TableSchema, ToolCall, ToolDefinition } from "./types";

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

export function createChatClient(fetchFn: typeof fetch = fetch) {
  const client = new ApiClient(CHAT_BASE_URL, { fetchFn, unwrapData: false });

  return {
    createSession(projectId: string, datasetId?: string): Promise<ChatSession> {
      return client.post<ChatSession>("/sessions", {
        project_id: projectId,
        dataset_id: datasetId ?? null,
      });
    },

    logTurn(sessionId: string, turn: ChatTurnPayload): Promise<void> {
      return client.post<void>(`/sessions/${sessionId}/turns`, turn);
    },

    getSession(sessionId: string): Promise<ChatSession> {
      return client.get<ChatSession>(`/sessions/${sessionId}`);
    },

    listSessions(datasetId: string): Promise<ChatSession[]> {
      return client.get<ChatSession[]>(
        `/sessions?dataset_id=${encodeURIComponent(datasetId)}`,
      );
    },

    async fetchChatStream(
      apiMessages: Array<{
        role: string;
        content: string;
        tool_calls?: ToolCall[];
      }>,
      tableSchema: TableSchema | null,
    ): Promise<Response> {
      const response = await fetchFn(`${CHAT_BASE_URL}/chat`, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, tableSchema }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error("No response body");
      return response;
    },
  };
}

export type ChatClient = ReturnType<typeof createChatClient>;
