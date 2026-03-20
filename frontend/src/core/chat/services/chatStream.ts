import type { ToolCall } from "@/toolCalls";

export interface SSEHandlers {
  onContent: (accumulatedContent: string) => void;
  onDone: (accumulatedContent: string, toolCalls: ToolCall[]) => void;
}

/** Reads the AI SDK data stream, dispatching parsed events to handlers.
 *
 * Line format (per AI SDK data stream protocol):
 *   0:"text token"         — text delta (JSON-encoded string)
 *   9:[{toolCallId,...}]   — tool call array
 *   d:{finishReason,...}   — stream finish
 *   e:{...}                — step finish (ignored)
 *   1:"error message"      — error
 */
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
      if (!line) continue;

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const prefix = line.slice(0, colonIdx);
      const payload = line.slice(colonIdx + 1).trim();
      if (!payload) continue;

      try {
        if (prefix === "0") {
          // Text delta — payload is a JSON-encoded string
          const token: string = JSON.parse(payload);
          accumulatedContent += token;
          handlers.onContent(accumulatedContent);
        } else if (prefix === "9") {
          // Tool call array
          const calls = JSON.parse(payload) as Array<{
            toolCallId: string;
            toolName: string;
            args: Record<string, unknown>;
          }>;
          // Map AI SDK format → ToolCall format used by executeToolCall
          toolCalls = calls.map((c) => ({
            id: c.toolCallId,
            type: "function" as const,
            function: {
              name: c.toolName,
              arguments: JSON.stringify(c.args),
            },
          }));
        } else if (prefix === "d") {
          // Stream finish
          handlers.onDone(accumulatedContent, toolCalls);
        } else if (prefix === "1") {
          // Error
          const errorMsg: string = JSON.parse(payload);
          throw new Error(errorMsg);
        }
        // Ignore: e (step finish), 2, 8, a, b, c
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
