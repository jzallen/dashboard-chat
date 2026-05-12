import { describe, expect, it, vi } from "vitest";

import type { ChatEvent } from "../events";
import { readSSEStream } from "../services/chatStream";

/**
 * v6 SSE wire format (AI SDK v6 UIMessage stream, served via
 * `JsonToSseTransformStream`):
 *
 *   data: {"type":"text-delta","id":"msg_1","delta":"hello"}\n\n
 *   data: {"type":"data-chat-event","id":"evt-1","data":{<ChatEvent>}}\n\n
 *   data: {"type":"data-agent-request","id":"req-1","data":{<AgentRequest>}}\n\n
 *   data: {"type":"finish","finishReason":"stop"}\n\n
 *   data: [DONE]\n\n
 *
 * Each "frame" is `data: <payload>\n` followed by a blank line. The parser
 * splits on `\n\n`, strips the leading `data: ` field name, JSON.parses the
 * payload, and dispatches on `payload.type`. The `data: [DONE]` sentinel is a
 * no-op terminator.
 */

/** Wrap an array of v6 chunk objects as an SSE byte stream. */
function v6Stream(chunks: Array<Record<string, unknown> | "[DONE]">): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        const payload = chunk === "[DONE]" ? "[DONE]" : JSON.stringify(chunk);
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.close();
    },
  });
}

describe("readSSEStream (v6 data-* parts)", () => {
  it("accumulates content from text-delta chunks", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = v6Stream([
      { type: "text-delta", id: "m1", delta: "Hello" },
      { type: "text-delta", id: "m1", delta: " world" },
      { type: "finish", finishReason: "stop" },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledTimes(2);
    expect(onContent).toHaveBeenNthCalledWith(1, "Hello");
    expect(onContent).toHaveBeenNthCalledWith(2, "Hello world");
    expect(onDone).toHaveBeenCalledWith("Hello world", []);
  });

  it("dispatches data-chat-event payloads through ChatEventSchema validation", async () => {
    const onChatEvent = vi.fn();
    const onContent = vi.fn();
    const onDone = vi.fn();

    const transformApplied: ChatEvent = {
      type: "transform_applied",
      transform_id: "t1",
      dataset_id: "ds1",
      operation: "trim",
      column: "region",
    };
    const sortDirective: ChatEvent = {
      type: "sort_directive",
      column: "amount",
      direction: "desc",
    };

    const stream = v6Stream([
      { type: "data-chat-event", id: "evt-1", data: transformApplied },
      { type: "data-chat-event", id: "evt-2", data: sortDirective },
      { type: "finish", finishReason: "stop" },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent, onDone, onChatEvent });

    expect(onChatEvent).toHaveBeenCalledTimes(2);
    expect(onChatEvent).toHaveBeenNthCalledWith(1, transformApplied);
    expect(onChatEvent).toHaveBeenNthCalledWith(2, sortDirective);
    expect(onDone).toHaveBeenCalledWith("", []);
  });

  it("silently drops data-chat-event payloads that fail ChatEventSchema validation", async () => {
    const onChatEvent = vi.fn();
    const onDone = vi.fn();

    const validEvent: ChatEvent = {
      type: "filters_cleared",
    };

    const stream = v6Stream([
      // type literal not in the discriminated union — safeParse fails
      { type: "data-chat-event", id: "bad", data: { type: "not_a_real_event" } },
      { type: "data-chat-event", id: "ok", data: validEvent },
      { type: "finish", finishReason: "stop" },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent: vi.fn(), onDone, onChatEvent });

    expect(onChatEvent).toHaveBeenCalledTimes(1);
    expect(onChatEvent).toHaveBeenCalledWith(validEvent);
  });

  it("ignores data-chat-event chunks when no onChatEvent handler is provided", async () => {
    const onDone = vi.fn();

    const stream = v6Stream([
      {
        type: "data-chat-event",
        id: "evt-1",
        data: { type: "transform_applied", transform_id: "t", dataset_id: "d", operation: "upper", column: "c" },
      },
      { type: "finish", finishReason: "stop" },
      "[DONE]",
    ]);

    // No onChatEvent — chunk should be dropped without throwing
    await readSSEStream(stream, { onContent: vi.fn(), onDone });

    expect(onDone).toHaveBeenCalledWith("", []);
  });

  it("dispatches data-agent-request to onRequest and skips onDone", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const onRequest = vi.fn();

    const stream = v6Stream([
      {
        type: "data-agent-request",
        id: "req-1",
        data: { type: "resolve_dataset", params: { name: "patients" } },
      },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent, onDone, onRequest });

    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest).toHaveBeenCalledWith({
      type: "resolve_dataset",
      params: { name: "patients" },
    });
    expect(onDone).not.toHaveBeenCalled();
  });

  it("accumulates content before data-agent-request", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const onRequest = vi.fn();

    const stream = v6Stream([
      { type: "text-delta", id: "m1", delta: "Looking up dataset..." },
      {
        type: "data-agent-request",
        id: "req-1",
        data: { type: "resolve_dataset", params: { name: "sales" } },
      },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent, onDone, onRequest });

    expect(onContent).toHaveBeenCalledWith("Looking up dataset...");
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("falls back to onDone when data-agent-request arrives but no onRequest handler", async () => {
    const onDone = vi.fn();

    const stream = v6Stream([
      {
        type: "data-agent-request",
        id: "req-1",
        data: { type: "resolve_dataset", params: { name: "test" } },
      },
      { type: "finish", finishReason: "stop" },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent: vi.fn(), onDone });

    expect(onDone).toHaveBeenCalledWith("", []);
  });

  it("calls onDone normally on finish chunk", async () => {
    const onDone = vi.fn();
    const onRequest = vi.fn();

    const stream = v6Stream([
      { type: "text-delta", id: "m1", delta: "Hello" },
      { type: "finish", finishReason: "stop" },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent: vi.fn(), onDone, onRequest });

    expect(onDone).toHaveBeenCalledWith("Hello", []);
    expect(onRequest).not.toHaveBeenCalled();
  });

  it("throws on error chunks", async () => {
    const stream = v6Stream([
      { type: "error", errorText: "Rate limited" },
    ]);

    await expect(
      readSSEStream(stream, { onContent: vi.fn(), onDone: vi.fn() }),
    ).rejects.toThrow("Rate limited");
  });

  it("ignores unknown chunk types", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = v6Stream([
      // Pass-through chunks the agent forwards verbatim that the FE doesn't act on.
      { type: "text-start", id: "m1" },
      { type: "text-delta", id: "m1", delta: "Hi" },
      { type: "text-end", id: "m1" },
      { type: "start" },
      { type: "finish", finishReason: "stop" },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledTimes(1);
    expect(onContent).toHaveBeenCalledWith("Hi");
    expect(onDone).toHaveBeenCalledWith("Hi", []);
  });

  it("skips the [DONE] sentinel", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = v6Stream([
      { type: "text-delta", id: "m1", delta: "X" },
      { type: "finish", finishReason: "stop" },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("X", []);
  });

  it("handles malformed JSON in a frame without crashing the stream", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onContent = vi.fn();
    const onDone = vi.fn();

    // Hand-craft a stream so we can interleave a non-JSON payload.
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode("data: {not valid json}\n\n"));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "text-delta", id: "m1", delta: "ok" })}\n\n`),
        );
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}\n\n`),
        );
        controller.close();
      },
    });

    await readSSEStream(stream, { onContent, onDone });

    expect(consoleSpy).toHaveBeenCalled();
    expect(onContent).toHaveBeenCalledWith("ok");
    expect(onDone).toHaveBeenCalledWith("ok", []);
    consoleSpy.mockRestore();
  });

  it("handles SSE frames split across multiple read() chunks", async () => {
    const encoder = new TextEncoder();
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        // Split a single `data: {...}\n\n` frame across three reads.
        controller.enqueue(encoder.encode('data: {"type":"text-de'));
        controller.enqueue(encoder.encode('lta","id":"m1","delta":"spl'));
        controller.enqueue(encoder.encode('it"}\n\n'));
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: "finish", finishReason: "stop" })}\n\n`),
        );
        controller.close();
      },
    });

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledWith("split");
    expect(onDone).toHaveBeenCalledWith("split", []);
  });

  it("does not call onDone when stream ends without a finish chunk", async () => {
    const onDone = vi.fn();
    const stream = v6Stream([
      { type: "text-delta", id: "m1", delta: "Hi" },
    ]);

    await readSSEStream(stream, { onContent: vi.fn(), onDone });

    expect(onDone).not.toHaveBeenCalled();
  });

  it("preserves causal order: text + chat-event + agent-request", async () => {
    const calls: Array<["content" | "event" | "request", unknown]> = [];
    const onContent = (c: string) => calls.push(["content", c]);
    const onChatEvent = (e: ChatEvent) => calls.push(["event", e]);
    const onRequest = (r: unknown) => calls.push(["request", r]);

    const event: ChatEvent = {
      type: "transform_applied",
      transform_id: "t1",
      dataset_id: "ds1",
      operation: "trim",
      column: "region",
    };

    const stream = v6Stream([
      { type: "text-delta", id: "m1", delta: "Trimming" },
      { type: "data-chat-event", id: "e1", data: event },
      { type: "data-agent-request", id: "r1", data: { type: "resolve_dataset", params: { name: "x" } } },
      "[DONE]",
    ]);

    await readSSEStream(stream, { onContent, onDone: vi.fn(), onChatEvent, onRequest });

    expect(calls.map((c) => c[0])).toEqual(["content", "event", "request"]);
  });
});
