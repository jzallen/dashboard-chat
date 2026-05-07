/**
 * Reusable v6 SSE parser helper for the agent test suite.
 *
 * Extracted from `walking-skeleton.test.ts` so the same parser is exercised by
 * both the live walking-skeleton test (against a real worker) and the cross-
 * stack wire-contract test (against canonical fixture bytes). Keeping the two
 * call sites bound to a single implementation guarantees that any drift in the
 * agent's expected v6 wire format surfaces in BOTH tests, not just one.
 *
 * Wire-format contract (AI SDK v6, `data-*` UIMessage stream):
 *   - Transport: `text/event-stream` SSE, frames separated by `\n\n`.
 *   - Each frame is `data: <UIMessageChunk JSON>` (or `data: [DONE]` sentinel).
 *   - Custom data parts arrive as `{type: 'data-chat-event', data: ChatEvent}`.
 *   - Raw `tool-*` parts surfacing here means the agent failed to translate
 *     Groq tool calls into typed `data-chat-event` parts.
 */

import { type ChatEvent, ChatEventSchema } from "../../../lib/chat/events";

interface UIMessageFrame {
  type: string;
  data?: unknown;
  [key: string]: unknown;
}

export async function consumeChatEvents(body: ReadableStream<Uint8Array>): Promise<{
  events: ChatEvent[];
  rawToolCallSeen: boolean;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: ChatEvent[] = [];
  let rawToolCallSeen = false;

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
      if (!trimmed.startsWith("data:")) continue;
      const payloadText = trimmed.slice("data:".length).trim();
      if (!payloadText) continue;
      if (payloadText === "[DONE]") continue;

      let payload: UIMessageFrame;
      try {
        payload = JSON.parse(payloadText) as UIMessageFrame;
      } catch {
        continue;
      }

      if (payload.type === "data-chat-event") {
        const result = ChatEventSchema.safeParse(payload.data);
        if (result.success) events.push(result.data);
        continue;
      }

      if (typeof payload.type === "string" && payload.type.startsWith("tool-")) {
        rawToolCallSeen = true;
      }
    }
  }
  return { events, rawToolCallSeen };
}

/**
 * Convenience: parse a UTF-8 byte array directly. Used by the wire-contract
 * test, which feeds canonical fixture bytes into the parser without a live
 * stream source.
 */
export async function consumeChatEventsFromBytes(bytes: Uint8Array): Promise<{
  events: ChatEvent[];
  rawToolCallSeen: boolean;
}> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return consumeChatEvents(stream);
}
