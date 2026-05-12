import type { ToolCall } from "@/toolCalls";

/**
 * Handler registered by DatasetDetail / ReportDetailView / ViewDetailView to
 * execute AI tool calls against the table.
 *
 * NOTE: As of the AI SDK v6 migration, tool execution is performed agent-side
 * and surfaced to the frontend via typed `data-chat-event` parts (see
 * `agent/lib/chat/pipeChatStream.ts`). The frontend's `readSSEStream` always
 * reports `toolCalls: []` to `onDone`, so this handler is no longer invoked
 * from the SSE path. It is retained because external callers still register
 * handlers via `registerToolHandler` and the type is part of the public
 * `ChatContext` surface.
 */
export interface ToolHandler {
  executeToolCall: (toolCall: ToolCall) => string | Promise<string>;
}
