import type { MutableRefObject, RefObject } from "react";

import { createSession, logTurn } from "@/api";
import { getSystemPrompt, getToolDefinitions } from "@/chat/prompts";
import type { ToolCall } from "@/table-tools";

import type { TableSchema } from "../../../types";

/** Fire-and-forget: creates a session if needed and logs the chat turn. */
export async function logChatTurn(
  sessionIdRef: MutableRefObject<string | null>,
  projectIdRef: RefObject<string | null>,
  datasetIdRef: RefObject<string | null>,
  tableSchema: TableSchema | null,
  userContent: string,
  assistantContent: string,
  toolCalls: ToolCall[],
  toolResults: Array<{ tool_call_id: string; result: string }> | null,
): Promise<void> {
  try {
    if (!sessionIdRef.current && projectIdRef.current && datasetIdRef.current) {
      const session = await createSession(projectIdRef.current, datasetIdRef.current);
      sessionIdRef.current = session.id;
    }
    if (sessionIdRef.current && tableSchema) {
      const systemPrompt = getSystemPrompt(tableSchema);
      const toolDefs = getToolDefinitions(tableSchema);
      await logTurn(sessionIdRef.current, {
        user_message: userContent,
        system_prompt: systemPrompt,
        tool_definitions: toolDefs,
        assistant_content: assistantContent,
        tool_calls: toolCalls.length > 0 ? toolCalls : null,
        tool_results: toolResults,
        table_schema: tableSchema,
      });
    }
  } catch (err) {
    console.error("Failed to log chat turn:", err);
  }
}
