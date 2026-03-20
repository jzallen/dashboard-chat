/**
 * Chat Agent API Client
 *
 * Factory-based client for all communication with the chat agent service.
 * Callers inject auth via fetchFn: createChatClient(withAuth(fetch)).
 */

import { CHAT_BASE_URL } from "@/http/config";

import type { TableSchema, ToolCall } from "./types";

export function createChatClient(fetchFn: typeof fetch = fetch) {
  return {
    async fetchChatStream(
      apiMessages: Array<{
        role: string;
        content: string;
        tool_calls?: ToolCall[];
      }>,
      tableSchema: TableSchema | null,
      contextType?: "dataset" | "view" | null,
      contextId?: string | null,
    ): Promise<Response> {
      const response = await fetchFn(`${CHAT_BASE_URL}/chat`, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          tableSchema,
          contextType: contextType ?? null,
          contextId: contextId ?? null,
        }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!response.body) throw new Error("No response body");
      return response;
    },
  };
}

export type ChatClient = ReturnType<typeof createChatClient>;
