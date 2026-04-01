import type { ToolCall } from "@/toolCalls";

/** Payload emitted by the agent via the `r:` SSE prefix, requesting data from the frontend. */
export interface AgentRequest {
  type: string;
  params: Record<string, unknown>;
}

export interface SSEHandlers {
  onContent: (accumulatedContent: string) => void;
  onDone: (accumulatedContent: string, toolCalls: ToolCall[]) => void;
  /** Called when the agent emits an `r:` request followed by `d:{finishReason:"request"}`. */
  onRequest?: (request: AgentRequest) => void;
}

/** Reads the AI SDK data stream, dispatching parsed events to handlers.
 *
 * Line format (per AI SDK data stream protocol):
 *   0:"text token"         — text delta (JSON-encoded string)
 *   9:[{toolCallId,...}]   — tool call array
 *   d:{finishReason,...}   — stream finish
 *   e:{...}                — step finish (ignored)
 *   1:"error message"      — error
 *   r:{type,params}        — agent request (extended protocol)
 */
export async function readSSEStream(body: ReadableStream<Uint8Array>, handlers: SSEHandlers): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedContent = "";
  let toolCalls: ToolCall[] = [];
  let pendingRequest: AgentRequest | null = null;

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
        } else if (prefix === "r") {
          // Agent request — store for dispatch on done
          pendingRequest = JSON.parse(payload) as AgentRequest;
        } else if (prefix === "d") {
          // Stream finish — check if this is an agent request finish
          let isAgentRequest = false;
          try {
            const donePayload = JSON.parse(payload) as { finishReason?: string };
            isAgentRequest = donePayload.finishReason === "request";
          } catch {
            // Malformed done payload — treat as normal finish
          }

          if (isAgentRequest && pendingRequest && handlers.onRequest) {
            handlers.onRequest(pendingRequest);
          } else {
            handlers.onDone(accumulatedContent, toolCalls);
          }
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
