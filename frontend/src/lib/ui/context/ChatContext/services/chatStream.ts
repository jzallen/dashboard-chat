import type { ToolCall } from "@/table-tools";

import type { SSEMessage } from "../../../types";

export interface SSEHandlers {
  onContent: (accumulatedContent: string) => void;
  onDone: (accumulatedContent: string, toolCalls: ToolCall[]) => void;
}

/** Reads the SSE stream, dispatching parsed events to handlers. */
export async function readSSEStream(body: ReadableStream<Uint8Array>, handlers: SSEHandlers): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedContent = "";
  let toolCalls: ToolCall[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr) continue;

      try {
        const data: SSEMessage = JSON.parse(jsonStr);

        switch (data.type) {
          case "content":
            if (data.content) {
              accumulatedContent += data.content;
              handlers.onContent(accumulatedContent);
            }
            break;
          case "tool_calls":
            if (data.tool_calls) toolCalls = data.tool_calls;
            break;
          case "error":
            throw new Error(data.error || "Stream error");
          case "done":
            handlers.onDone(accumulatedContent, toolCalls);
            break;
        }
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          console.error("Parse error:", parseError);
        } else {
          throw parseError;
        }
      }
    }
  }
}
