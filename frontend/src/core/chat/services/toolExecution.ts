import type { ToolCall } from "@/toolCalls";

/** Handler registered by DatasetDetail to execute AI tool calls against the table. */
export interface ToolHandler {
  executeToolCall: (toolCall: ToolCall) => string | Promise<string>;
}

/** Executes tool calls via the registered handler and returns paired results. */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  toolHandler: ToolHandler,
): Promise<{ results: string[]; toolResults: Array<{ tool_call_id: string; result: string }> }> {
  const results = await Promise.all(toolCalls.map((tc) => toolHandler.executeToolCall(tc)));
  const toolResults = toolCalls.map((tc, i) => ({ tool_call_id: tc.id, result: results[i] }));
  return { results, toolResults };
}
