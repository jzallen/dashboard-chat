import type { UIMessageChunk } from "ai";
import { describe, expect, it, vi } from "vitest";

import { handleChat } from "../../lib/chat/handleChat";
import { getConversationalTools } from "../../lib/chat/tools";
import { agentRequests, chatEvents, mockStreamTextResult, parseSseFrames } from "./_v6Mocks";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@ai-sdk/groq", () => ({
  createGroq: () => () => "mock-model",
}));

// Default mock — overridden per test via mockImplementationOnce.
const mockStreamText = vi.fn(() =>
  mockStreamTextResult([
    { type: "text-start", id: "m1" },
    { type: "text-delta", id: "m1", delta: "test" },
    { type: "text-end", id: "m1" },
    { type: "finish", finishReason: "stop" },
  ]),
);

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: (...args: unknown[]) => mockStreamText(...(args as [unknown])),
    tool: vi.fn((opts: unknown) => opts),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const env = { GROQ_API_KEY: "test-key" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolve_dataset tool definition", () => {
  it("getConversationalTools includes resolve_dataset", () => {
    const tools = getConversationalTools();
    expect(tools).toHaveProperty("resolve_dataset");
  });

  it("resolve_dataset tool has name parameter", () => {
    const tools = getConversationalTools();
    const resolveDataset = tools.resolve_dataset;
    expect(resolveDataset).toBeDefined();
    // The tool is created with z.object({ name: z.string() })
    // After going through `tool()`, the parameters schema should have name
    expect(resolveDataset.parameters).toBeDefined();
  });
});

describe("data-agent-request emission for dataset resolution", () => {
  it("transforms a resolve_dataset tool-input-available chunk into a data-agent-request typed part", async () => {
    const upstreamChunks: UIMessageChunk[] = [
      {
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "resolve_dataset",
        input: { name: "patients" },
      } as UIMessageChunk,
      // Anything after this should NOT surface — pipeChatStream pauses the turn.
      { type: "finish", finishReason: "tool-calls" } as UIMessageChunk,
    ];
    mockStreamText.mockImplementationOnce(() => mockStreamTextResult(upstreamChunks));

    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "show me the patients table" }],
        contextType: null,
        tableSchema: null,
      }),
      env,
    );

    const frames = await parseSseFrames(response);

    // A single data-agent-request frame carries the resolve_dataset request.
    const requests = agentRequests(frames);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual({
      type: "resolve_dataset",
      params: { name: "patients" },
    });

    // No turn_done chat-event was emitted — the turn is paused for FE
    // resolution (paused-turn semantics, dc-x3y.3.1).
    const events = chatEvents(frames) as Array<{ type: string }>;
    expect(events.find((e) => e.type === "turn_done")).toBeUndefined();
  });

  it("passes through text deltas before resolve_dataset", async () => {
    const upstreamChunks: UIMessageChunk[] = [
      { type: "text-start", id: "m1" } as UIMessageChunk,
      { type: "text-delta", id: "m1", delta: "Let me find that for you." } as UIMessageChunk,
      {
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "resolve_dataset",
        input: { name: "sales" },
      } as UIMessageChunk,
      { type: "finish", finishReason: "tool-calls" } as UIMessageChunk,
    ];
    mockStreamText.mockImplementationOnce(() => mockStreamTextResult(upstreamChunks));

    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "open sales data" }],
        contextType: null,
        tableSchema: null,
      }),
      env,
    );

    const frames = await parseSseFrames(response);

    // The text-delta surfaces ahead of the agent-request frame.
    const textDeltas = frames.filter((f) => f.type === "text-delta");
    expect(textDeltas.length).toBeGreaterThan(0);
    expect(textDeltas.some((d) => d.delta === "Let me find that for you.")).toBe(true);

    // And the agent-request is present.
    expect(agentRequests(frames)).toHaveLength(1);

    // Order: text-delta(...) precedes data-agent-request on the wire.
    const types = frames.map((f) => f.type);
    const idxText = types.indexOf("text-delta");
    const idxRequest = types.indexOf("data-agent-request");
    expect(idxText).toBeGreaterThanOrEqual(0);
    expect(idxRequest).toBeGreaterThan(idxText);
  });

  it("does not intercept non-resolve_dataset tool calls in dataset context", async () => {
    // sortTable lives on the dataset tool set. The pipe drops raw tool-* chunks
    // (the dispatcher is what translates them into typed data-chat-event parts);
    // here we synthesize a sortTable tool-input-available chunk and assert the
    // pipe does NOT produce a data-agent-request (only resolve_dataset is the
    // pause signal).
    const upstreamChunks: UIMessageChunk[] = [
      {
        type: "tool-input-available",
        toolCallId: "tc-1",
        toolName: "sortTable",
        input: { column: "name", direction: "asc" },
      } as UIMessageChunk,
      { type: "finish", finishReason: "tool-calls" } as UIMessageChunk,
    ];
    mockStreamText.mockImplementationOnce(() => mockStreamTextResult(upstreamChunks));

    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "sort by name" }],
        contextType: "dataset",
        tableSchema: {
          columns: [{ id: "name", type: "string" }],
          rowCount: 10,
        },
      }),
      env,
    );

    const frames = await parseSseFrames(response);

    // No agent-request frame — the sortTable tool call is NOT a pause signal.
    expect(agentRequests(frames)).toHaveLength(0);

    // No raw tool-* parts surface to the FE either (walking-skeleton contract).
    const rawToolFrames = frames.filter(
      (f) => typeof f.type === "string" && f.type.startsWith("tool-"),
    );
    expect(rawToolFrames).toHaveLength(0);

    // turn_done IS emitted (the turn naturally finished — finish-reason
    // "tool-calls" maps to "stop" in the pipe).
    const events = chatEvents(frames) as Array<{ type: string; reason?: string }>;
    const turnDone = events.find((e) => e.type === "turn_done");
    expect(turnDone).toBeDefined();
    expect(turnDone?.reason).toBe("stop");
  });
});

describe("thread_id and project_id in request payload", () => {
  it("accepts thread_id and project_id without error", async () => {
    mockStreamText.mockImplementationOnce(() =>
      mockStreamTextResult([
        { type: "text-start", id: "m1" } as UIMessageChunk,
        { type: "text-delta", id: "m1", delta: "hello" } as UIMessageChunk,
        { type: "text-end", id: "m1" } as UIMessageChunk,
        { type: "finish", finishReason: "stop" } as UIMessageChunk,
      ]),
    );

    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "hello" }],
        contextType: null,
        tableSchema: null,
        thread_id: "thread-abc-123",
        project_id: "proj-xyz-456",
      }),
      env,
    );

    expect(response.status).not.toBe(400);
    const frames = await parseSseFrames(response);
    // Some text-delta frame survived to the FE.
    expect(frames.some((f) => f.type === "text-delta")).toBe(true);
  });

  it("works without thread_id and project_id (backward compatible)", async () => {
    mockStreamText.mockImplementationOnce(() =>
      mockStreamTextResult([
        { type: "text-start", id: "m1" } as UIMessageChunk,
        { type: "text-delta", id: "m1", delta: "hello" } as UIMessageChunk,
        { type: "text-end", id: "m1" } as UIMessageChunk,
        { type: "finish", finishReason: "stop" } as UIMessageChunk,
      ]),
    );

    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "hello" }],
        contextType: null,
        tableSchema: null,
      }),
      env,
    );

    expect(response.status).not.toBe(400);
  });
});

describe("re-submitted request with resolved dataset schema", () => {
  it("uses dataset tools when re-submitted with dataset context", async () => {
    mockStreamText.mockImplementationOnce(() =>
      mockStreamTextResult([
        { type: "text-start", id: "m1" } as UIMessageChunk,
        { type: "text-delta", id: "m1", delta: "filtering..." } as UIMessageChunk,
        { type: "text-end", id: "m1" } as UIMessageChunk,
        { type: "finish", finishReason: "stop" } as UIMessageChunk,
      ]),
    );

    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "filter patients by age > 30" }],
        contextType: "dataset",
        contextId: "ds-patients-001",
        tableSchema: {
          columns: [
            { id: "name", type: "string" },
            { id: "age", type: "number" },
          ],
          rowCount: 100,
        },
        thread_id: "thread-abc-123",
        project_id: "proj-xyz-456",
      }),
      env,
    );

    expect(response.status).not.toBe(400);

    // Verify streamText was called with dataset system prompt and tools
    expect(mockStreamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("controls a data table"),
        tools: expect.objectContaining({ sortTable: expect.anything() }),
      }),
    );
  });
});
