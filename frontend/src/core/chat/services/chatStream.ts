import type { ToolCall } from "@/toolCalls";

import { type ChatEvent,ChatEventSchema } from "../events";

/**
 * Payload emitted by the agent via a `data-agent-request` typed part,
 * requesting data from the frontend (e.g. `resolve_dataset`).
 */
export interface AgentRequest {
  type: string;
  params: Record<string, unknown>;
}

export interface SSEHandlers {
  onContent: (accumulatedContent: string) => void;
  onDone: (accumulatedContent: string, toolCalls: ToolCall[]) => void;
  /** Called when the agent emits a `data-agent-request` part (paused-turn). */
  onRequest?: (request: AgentRequest) => void;
  /** Called when the agent emits a `data-chat-event` typed part. */
  onChatEvent?: (event: ChatEvent) => void;
}

/**
 * Reads the AI SDK v6 UIMessage SSE stream, dispatching parsed chunks to
 * handlers. The agent serializes its UIMessageChunk stream via
 * `JsonToSseTransformStream`, producing frames of the shape:
 *
 *   data: {"type":"text-delta","id":"...","delta":"..."}\n\n
 *   data: {"type":"data-chat-event","id":"...","data":{<ChatEvent>}}\n\n
 *   data: {"type":"data-agent-request","id":"...","data":{<AgentRequest>}}\n\n
 *   data: {"type":"finish","finishReason":"stop",...}\n\n
 *   data: [DONE]\n\n
 *
 * Dispatch table:
 *   - `text-delta`           → `onContent(accumulatedContent)`
 *   - `data-chat-event`      → `onChatEvent(safeParse(payload.data))`
 *   - `data-agent-request`   → captured; dispatched on stream end
 *   - `finish`               → `onRequest` if a request was captured, else `onDone`
 *   - `error`                → throws with the supplied `errorText`
 *   - `[DONE]` sentinel      → no-op terminator
 *   - all other types        → silently ignored (`text-start`, `text-end`,
 *                              `start`, `start-step`, `finish-step`, ...)
 *
 * Per `pipeChatStream.ts` (the agent emit side), raw `tool-*` chunks are
 * stripped upstream and translated into typed `data-chat-event` parts. The
 * legacy `9:` tool-call array is therefore not surfaced and `toolCalls` is
 * always reported as `[]` to `onDone` for backwards compatibility with the
 * existing handler signature.
 */
export async function readSSEStream(body: ReadableStream<Uint8Array>, handlers: SSEHandlers): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulatedContent = "";
  let pendingRequest: AgentRequest | null = null;
  let finished = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    // v6 SSE frames are separated by a blank line (\n\n).
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const trimmed = frame.trim();
      if (!trimmed) continue;
      // Each frame begins with `data: `. Strip the field name.
      if (!trimmed.startsWith("data:")) continue;
      const payloadText = trimmed.slice("data:".length).trim();
      if (!payloadText) continue;
      // Sentinel terminator emitted by JsonToSseTransformStream.
      if (payloadText === "[DONE]") continue;

      let payload: { type?: string; [key: string]: unknown };
      try {
        payload = JSON.parse(payloadText);
      } catch (parseError) {
        if (parseError instanceof SyntaxError) {
          console.error("Parse error:", parseError);
          continue;
        }
        throw parseError;
      }

      const type = payload.type;
      if (type === "text-delta") {
        const delta = payload.delta;
        if (typeof delta !== "string") continue;
        accumulatedContent += delta;
        handlers.onContent(accumulatedContent);
      } else if (type === "data-chat-event") {
        if (!handlers.onChatEvent) continue;
        const result = ChatEventSchema.safeParse(payload.data);
        if (result.success) {
          handlers.onChatEvent(result.data);
        }
      } else if (type === "data-agent-request") {
        const data = payload.data as AgentRequest | undefined;
        if (data && typeof data.type === "string") {
          pendingRequest = data;
        }
      } else if (type === "finish") {
        finished = true;
        if (pendingRequest && handlers.onRequest) {
          handlers.onRequest(pendingRequest);
        } else {
          handlers.onDone(accumulatedContent, []);
        }
      } else if (type === "error") {
        const errorText = typeof payload.errorText === "string" ? payload.errorText : "Stream error";
        throw new Error(errorText);
      }
      // All other v6 chunk types (text-start, text-end, start, start-step,
      // finish-step, reasoning-*, tool-* deltas the agent forgot to strip,
      // raw, source, file) are silently ignored — the FE has no behavior
      // attached to them.
    }
  }

  // The agent's `data-agent-request` interception path stops draining upstream
  // BEFORE emitting a `finish` chunk (see pipeChatStream.ts: paused-turn
  // semantics). Honour that by dispatching the captured request when the
  // stream ends without a `finish` frame.
  if (!finished && pendingRequest && handlers.onRequest) {
    handlers.onRequest(pendingRequest);
  }
}
