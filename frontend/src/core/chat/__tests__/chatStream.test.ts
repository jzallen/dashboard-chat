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
      '0:"Hello"',
      '0:" world"',
      `d:${JSON.stringify({ finishReason: "stop" })}`,
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
      { toolCallId: "tc-1", toolName: "sort", args: {} },
    ];
    const stream = createStream([
      `9:${JSON.stringify(toolCalls)}`,
      `d:${JSON.stringify({ finishReason: "tool-calls" })}`,
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onDone).toHaveBeenCalledWith("", [
      {
        id: "tc-1",
        type: "function",
        function: { name: "sort", arguments: "{}" },
      },
    ]);
  });

  it("throws on error events", async () => {
    const stream = createStream([
      '1:"Rate limited"',
    ]);

    await expect(
      readSSEStream(stream, { onContent: vi.fn(), onDone: vi.fn() }),
    ).rejects.toThrow("Rate limited");
  });

  it("ignores unknown prefix lines", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = createStream([
      "e:{}",
      '0:"Hi"',
      `d:${JSON.stringify({ finishReason: "stop" })}`,
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("Hi", []);
  });

  it("skips empty lines", async () => {
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = createStream([
      "",
      '0:"X"',
      `d:${JSON.stringify({ finishReason: "stop" })}`,
    ]);

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledTimes(1);
  });

  it("handles malformed JSON gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onContent = vi.fn();
    const onDone = vi.fn();
    const stream = createStream([
      "0:{not valid json}",
      '0:"ok"',
      `d:${JSON.stringify({ finishReason: "stop" })}`,
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
        controller.enqueue(encoder.encode('0:"spl'));
        controller.enqueue(encoder.encode('it"\n'));
        controller.enqueue(encoder.encode(`d:${JSON.stringify({ finishReason: "stop" })}\n`));
        controller.close();
      },
    });

    await readSSEStream(stream, { onContent, onDone });

    expect(onContent).toHaveBeenCalledWith("split");
    expect(onDone).toHaveBeenCalledWith("split", []);
  });

  it("last tool_calls event wins", async () => {
    const onDone = vi.fn();
    const tc1 = [{ toolCallId: "1", toolName: "a", args: {} }];
    const tc2 = [{ toolCallId: "2", toolName: "b", args: {} }];
    const stream = createStream([
      `9:${JSON.stringify(tc1)}`,
      `9:${JSON.stringify(tc2)}`,
      `d:${JSON.stringify({ finishReason: "tool-calls" })}`,
    ]);

    await readSSEStream(stream, { onContent: vi.fn(), onDone });

    expect(onDone).toHaveBeenCalledWith("", [
      { id: "2", type: "function", function: { name: "b", arguments: "{}" } },
    ]);
  });

  it("does not call onDone when stream ends without done event", async () => {
    const onDone = vi.fn();
    const stream = createStream([
      '0:"Hi"',
    ]);

    await readSSEStream(stream, { onContent: vi.fn(), onDone });

    expect(onDone).not.toHaveBeenCalled();
  });
});
