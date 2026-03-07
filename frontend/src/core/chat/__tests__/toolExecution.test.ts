import { describe, expect, it, vi } from "vitest";

import { executeToolCalls } from "../services/toolExecution";

function makeToolCall(id: string, name: string, args = "{}") {
  return { id, type: "function" as const, function: { name, arguments: args } };
}

describe("executeToolCalls", () => {
  it("executes all tool calls and returns paired results", async () => {
    const handler = {
      executeToolCall: vi.fn()
        .mockReturnValueOnce("result-1")
        .mockReturnValueOnce("result-2"),
    };
    const toolCalls = [makeToolCall("tc-1", "sort"), makeToolCall("tc-2", "filter")];

    const { results, toolResults } = await executeToolCalls(toolCalls, handler);

    expect(results).toEqual(["result-1", "result-2"]);
    expect(toolResults).toEqual([
      { tool_call_id: "tc-1", result: "result-1" },
      { tool_call_id: "tc-2", result: "result-2" },
    ]);
    expect(handler.executeToolCall).toHaveBeenCalledTimes(2);
  });

  it("handles a single tool call", async () => {
    const handler = { executeToolCall: vi.fn().mockReturnValue("done") };

    const { results, toolResults } = await executeToolCalls(
      [makeToolCall("tc-1", "sort")],
      handler,
    );

    expect(results).toEqual(["done"]);
    expect(toolResults).toEqual([{ tool_call_id: "tc-1", result: "done" }]);
  });

  it("returns empty arrays for no tool calls", async () => {
    const handler = { executeToolCall: vi.fn() };

    const { results, toolResults } = await executeToolCalls([], handler);

    expect(results).toEqual([]);
    expect(toolResults).toEqual([]);
    expect(handler.executeToolCall).not.toHaveBeenCalled();
  });

  it("handles async handlers", async () => {
    const handler = {
      executeToolCall: vi.fn().mockResolvedValue("async-result"),
    };

    const { results } = await executeToolCalls(
      [makeToolCall("tc-1", "sort")],
      handler,
    );

    expect(results).toEqual(["async-result"]);
  });

  it("executes tool calls in parallel", async () => {
    const order: string[] = [];
    const handler = {
      executeToolCall: vi.fn().mockImplementation(async (tc) => {
        order.push("start-" + tc.id);
        await Promise.resolve();
        order.push("end-" + tc.id);
        return "result-" + tc.id;
      }),
    };

    await executeToolCalls(
      [makeToolCall("1", "a"), makeToolCall("2", "b")],
      handler,
    );

    expect(order[0]).toBe("start-1");
    expect(order[1]).toBe("start-2");
  });

  it("propagates handler errors", async () => {
    const handler = {
      executeToolCall: vi.fn().mockRejectedValue(new Error("handler failed")),
    };

    await expect(
      executeToolCalls([makeToolCall("tc-1", "sort")], handler),
    ).rejects.toThrow("handler failed");
  });
});
