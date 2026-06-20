// Client-side SSE frame reader for the agent's AI-SDK-v6 UIMessage stream.
//
// Ported from frontend/src/core/chat/services/chatStream.ts, trimmed to ui/'s
// needs and self-contained — NO @dashboard-chat/shared-chat dependency (DWD-5):
// the agent emits JSON chat events on the wire and ui/ routes behaviour by their
// `type` discriminant. Adopting the shared zod schema in ui/ is a named follow-up.
//
// This runs on the CLIENT: the /ui-server/chat resource route pipes the upstream SSE
// straight back un-buffered (DWD-3), and this reader parses the frames in the
// browser. Frames are AI-SDK-v6 UIMessage chunks separated by a blank line:
//
//   data: {"type":"text-delta","id":"…","delta":"…"}\n\n
//   data: {"type":"data-chat-event","id":"…","data":{<ChatEvent>}}\n\n
//   data: {"type":"finish","finishReason":"stop"}\n\n
//   data: [DONE]\n\n

/** A chat domain event / UI directive as it arrives on the wire (the agent's
 *  `data-chat-event` payload). Only the `type` discriminant is needed to route
 *  catalog revalidation; the rest is carried opaquely. */
export interface ChatStreamEvent {
  type: string;
  [key: string]: unknown;
}

export interface ChatStreamHandlers {
  /** Called on every `text-delta` with the FULL accumulated assistant text. */
  onText: (accumulated: string) => void;
  /** Called for each `data-chat-event` domain event / UI directive. */
  onEvent?: (event: ChatStreamEvent) => void;
  /** Called once when the stream finishes (a `finish` frame, or end-of-stream). */
  onDone?: (accumulated: string) => void;
  /** Called when the agent emits an `error` frame. */
  onError?: (message: string) => void;
}

/** Domain events that mutate a dataset and therefore warrant a scoped catalog
 *  revalidation (the live assistant-transform reflection). Text/turn/error events
 *  and UI directives (sort/filter) do NOT — they are client-render-only. */
const CATALOG_MUTATING_EVENTS = new Set<string>([
  "transform_applied",
  "column_renamed",
  "row_added",
  "row_deleted",
  "transform_undone",
  "transform_re_enabled",
]);

/** True when an event changes the underlying dataset and the scoped catalog
 *  should be revalidated so the lineage/preview reflects it. */
export function isCatalogMutatingEvent(event: ChatStreamEvent): boolean {
  return CATALOG_MUTATING_EVENTS.has(event.type);
}

/**
 * Read the agent SSE stream to completion, dispatching parsed frames to the
 * handlers. Buffers partial frames across chunk boundaries. All non-handled v6
 * chunk types (text-start, text-end, start, start-step, finish-step, reasoning-*,
 * tool-* …) are silently ignored — ui/ has no behaviour attached to them.
 */
export async function readChatStream(
  body: ReadableStream<Uint8Array>,
  handlers: ChatStreamHandlers,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let accumulated = "";
  let finished = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    // v6 SSE frames are separated by a blank line (\n\n); the trailing partial
    // frame stays in the buffer until its terminator arrives.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const trimmed = frame.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payloadText = trimmed.slice("data:".length).trim();
      if (!payloadText || payloadText === "[DONE]") continue;

      let payload: { type?: string; [key: string]: unknown };
      try {
        payload = JSON.parse(payloadText);
      } catch {
        continue; // skip malformed frames rather than abort the turn
      }

      const type = payload.type;
      if (type === "text-delta") {
        if (typeof payload.delta !== "string") continue;
        accumulated += payload.delta;
        handlers.onText(accumulated);
      } else if (type === "data-chat-event") {
        const data = payload.data as ChatStreamEvent | undefined;
        if (data && typeof data.type === "string") handlers.onEvent?.(data);
      } else if (type === "finish") {
        finished = true;
        handlers.onDone?.(accumulated);
      } else if (type === "error") {
        const message =
          typeof payload.errorText === "string"
            ? payload.errorText
            : "Stream error";
        handlers.onError?.(message);
      }
    }
  }

  // End-of-stream without an explicit finish frame still resolves the turn.
  if (!finished) handlers.onDone?.(accumulated);
}
