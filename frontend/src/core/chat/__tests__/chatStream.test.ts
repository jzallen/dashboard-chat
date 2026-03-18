import { describe, expect, it, vi } from "vitest";

import { readSSEStream } from "../services/chatStream";

function createStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + "\n"));
      }
      controller.close();
    },
  });
}

describe("readSSEStream", () => {
  it("accumulates content from multiple events", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = createStream([
      'data: {"type":"content","content":"Hello"}',
      'data: {"type":"content","content":" world"}',
      'data: {"type":"done"}',
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledTimes(2);
    expect(onContent).toHaveBeenNthCalledWith(1, "Hello");
    expect(onContent).toHaveBeenNthCalledWith(2, "Hello world");
    expect(onDone).toHaveBeenCalledWith("Hello world", []);
  });

  it("passes tool calls to onDone", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const toolCalls = [
      { id: "tc-1", type: "function", function: { name: "sort", arguments: "{}" } },
    ];
    const stream = createStream([
      'data: ' + JSON.stringify({ type: "tool_calls", tool_calls: toolCalls }),
      'data: {"type":"done"}',
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onDone).toHaveBeenCalledWith("", toolCalls);
  });

  it("throws on error events", async () => {
    const stream = createStream([
      'data: {"type":"error","error":"Rate limited"}',
    ]);

    await expect(
      readSSEStream(stream, { onContent: vi.fn(), onDone: vi.fn() }),
    ).rejects.toThrow("Rate limited");
  });

  it("uses default error message when none provided", async () => {
    const stream = createStream(['data: {"type":"error"}']);

    await expect(
      readSSEStream(stream, { onContent: vi.fn(), onDone: vi.fn() }),
    ).rejects.toThrow("Stream error");
  });

  it("ignores non-data lines", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = createStream([
      ": comment",
      "event: message",
      'data: {"type":"content","content":"Hi"}',
      'data: {"type":"done"}',
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("Hi", []);
  });

  it("skips empty data payloads", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = createStream([
      "data: ",
      'data: {"type":"content","content":"X"}',
      'data: {"type":"done"}',
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledTimes(1);
  });

  it("skips content events with no content field", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = createStream([
      'data: {"type":"content"}',
      'data: {"type":"content","content":"real"}',
      'data: {"type":"done"}',
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledTimes(1);
    expect(onContent).toHaveBeenCalledWith("real");
  });

  it("handles malformed JSON gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = createStream([
      "data: {not valid json}",
      'data: {"type":"content","content":"ok"}',
      'data: {"type":"done"}',
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(consoleSpy).toHaveBeenCalled();
    expect(onContent).toHaveBeenCalledWith("ok");
    consoleSpy.mockRestore();
  });

  it("handles data split across multiple chunks", async () => {
    const encoder = new TextEncoder();
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"con'));
        controller.enqueue(encoder.encode('tent","content":"split"}\n'));
        controller.enqueue(encoder.encode('data: {"type":"done"}\n'));
        controller.close();
      },
    });

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledWith("split");
    expect(onDone).toHaveBeenCalledWith("split", []);
  });

  it("last tool_calls event wins", async () => {
    const onDone = vi.fn();
    const tc1 = [{ id: "1", type: "function", function: { name: "a", arguments: "{}" } }];
    const tc2 = [{ id: "2", type: "function", function: { name: "b", arguments: "{}" } }];
    const stream = createStream([
      'data: ' + JSON.stringify({ type: "tool_calls", tool_calls: tc1 }),
      'data: ' + JSON.stringify({ type: "tool_calls", tool_calls: tc2 }),
      'data: {"type":"done"}',
    ]);

    await readSSEStream(stream, { onContent: vi.fn(), onDone });

    expect(onDone).toHaveBeenCalledWith("", tc2);
  });

  it("does not call onDone when stream ends without done event", async () => {
    const onDone = vi.fn();
    const stream = createStream([
      'data: {"type":"content","content":"Hi"}',
    ]);

    await readSSEStream(stream, { onContent: vi.fn(), onDone });

    expect(onDone).not.toHaveBeenCalled();
  });
});
