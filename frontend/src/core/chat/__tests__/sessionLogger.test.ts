import { beforeEach, describe, expect, it, vi } from "vitest";

import { logChatTurn } from "../services/sessionLogger";

function makeRef<T>(value: T) {
  return { current: value };
}

function makeMockClient() {
  return {
    createSession: vi.fn().mockResolvedValue({ id: "session-1" }),
    logTurn: vi.fn().mockResolvedValue(undefined),
  };
}

const schema = {
  columns: [{ id: "name", type: "string" as const }],
  rowCount: 10,
};

describe("logChatTurn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates session and logs turn when no session exists", async () => {
    const client = makeMockClient();
    const sessionRef = makeRef<string | null>(null);

    await logChatTurn(
      client as any,
      sessionRef,
      makeRef("proj-1"),
      makeRef("ds-1"),
      schema,
      "hello",
      "hi there",
      [],
      null,
    );

    expect(client.createSession).toHaveBeenCalledWith("proj-1", "ds-1");
    expect(sessionRef.current).toBe("session-1");
    expect(client.logTurn).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        user_message: "hello",
        assistant_content: "hi there",
      }),
    );
  });

  it("reuses existing session", async () => {
    const client = makeMockClient();

    await logChatTurn(
      client as any,
      makeRef("existing-session"),
      makeRef("proj-1"),
      makeRef("ds-1"),
      schema,
      "hello",
      "response",
      [],
      null,
    );

    expect(client.createSession).not.toHaveBeenCalled();
    expect(client.logTurn).toHaveBeenCalledWith("existing-session", expect.any(Object));
  });

  it("skips session creation when projectId is null", async () => {
    const client = makeMockClient();

    await logChatTurn(
      client as any,
      makeRef<string | null>(null),
      makeRef<string | null>(null),
      makeRef("ds-1"),
      schema,
      "hello",
      "response",
      [],
      null,
    );

    expect(client.createSession).not.toHaveBeenCalled();
    expect(client.logTurn).not.toHaveBeenCalled();
  });

  it("skips session creation when datasetId is null", async () => {
    const client = makeMockClient();

    await logChatTurn(
      client as any,
      makeRef<string | null>(null),
      makeRef("proj-1"),
      makeRef<string | null>(null),
      schema,
      "hello",
      "response",
      [],
      null,
    );

    expect(client.createSession).not.toHaveBeenCalled();
    expect(client.logTurn).not.toHaveBeenCalled();
  });

  it("skips logTurn when tableSchema is null", async () => {
    const client = makeMockClient();

    await logChatTurn(
      client as any,
      makeRef("session-1"),
      makeRef("proj-1"),
      makeRef("ds-1"),
      null,
      "hello",
      "response",
      [],
      null,
    );

    expect(client.logTurn).not.toHaveBeenCalled();
  });

  it("includes tool_calls when present", async () => {
    const client = makeMockClient();
    const toolCalls = [
      { id: "tc-1", type: "function" as const, function: { name: "sort", arguments: "{}" } },
    ];
    const toolResults = [{ tool_call_id: "tc-1", result: "ok" }];

    await logChatTurn(
      client as any,
      makeRef("session-1"),
      makeRef("proj-1"),
      makeRef("ds-1"),
      schema,
      "sort by name",
      "done",
      toolCalls,
      toolResults,
    );

    expect(client.logTurn).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({
        tool_calls: toolCalls,
        tool_results: toolResults,
      }),
    );
  });

  it("sends null tool_calls when array is empty", async () => {
    const client = makeMockClient();

    await logChatTurn(
      client as any,
      makeRef("session-1"),
      makeRef("proj-1"),
      makeRef("ds-1"),
      schema,
      "hello",
      "response",
      [],
      null,
    );

    expect(client.logTurn).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ tool_calls: null }),
    );
  });

  it("swallows errors and logs to console", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeMockClient();
    client.logTurn.mockRejectedValue(new Error("network error"));

    await logChatTurn(
      client as any,
      makeRef("session-1"),
      makeRef("proj-1"),
      makeRef("ds-1"),
      schema,
      "hello",
      "response",
      [],
      null,
    );

    expect(consoleSpy).toHaveBeenCalledWith(
      "Failed to log chat turn:",
      expect.any(Error),
    );
    consoleSpy.mockRestore();
  });
});
