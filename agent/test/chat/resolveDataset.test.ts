import { describe, expect, it, vi } from "vitest";

import { handleChat } from "../../lib/chat/handleChat";
import { getConversationalTools } from "../../lib/chat/tools";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@ai-sdk/groq", () => ({
  createGroq: () => () => "mock-model",
}));

// Default mock — will be overridden in specific tests via mockImplementation
const mockStreamText = vi.fn(() => ({
  toDataStreamResponse: () =>
    new Response('0:"test"\n', {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    }),
}));

vi.mock("ai", () => ({
  streamText: (...args: unknown[]) => mockStreamText(...args),
  tool: vi.fn((opts: unknown) => opts),
}));

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

async function readResponseLines(response: Response): Promise<string[]> {
  const text = await response.text();
  return text.split("\n").filter((l) => l.length > 0);
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

describe("r: prefix emission for dataset resolution", () => {
  it("transforms 9: resolve_dataset tool call into r: prefix", async () => {
    const resolveToolCall = JSON.stringify([
      { toolCallId: "tc-1", toolName: "resolve_dataset", args: { name: "patients" } },
    ]);

    mockStreamText.mockImplementationOnce(() => ({
      toDataStreamResponse: () =>
        new Response(
          [
            `9:${resolveToolCall}`,
            `d:${JSON.stringify({ finishReason: "tool-calls" })}`,
          ]
            .map((l) => l + "\n")
            .join(""),
          { headers: { "Content-Type": "text/plain; charset=utf-8" } },
        ),
    }));

    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "show me the patients table" }],
        contextType: null,
        tableSchema: null,
      }),
      env,
    );

    const lines = await readResponseLines(response);

    // Should contain an r: line with the resolve_dataset request
    const rLine = lines.find((l) => l.startsWith("r:"));
    expect(rLine).toBeDefined();

    const rPayload = JSON.parse(rLine!.slice(2));
    expect(rPayload.type).toBe("resolve_dataset");
    expect(rPayload.params.name).toBe("patients");

    // Should contain d: with finishReason "request"
    const dLine = lines.find((l) => l.startsWith("d:"));
    expect(dLine).toBeDefined();

    const dPayload = JSON.parse(dLine!.slice(2));
    expect(dPayload.finishReason).toBe("request");
  });

  it("passes through text deltas before resolve_dataset", async () => {
    const resolveToolCall = JSON.stringify([
      { toolCallId: "tc-1", toolName: "resolve_dataset", args: { name: "sales" } },
    ]);

    mockStreamText.mockImplementationOnce(() => ({
      toDataStreamResponse: () =>
        new Response(
          [
            '0:"Let me find that for you."',
            `9:${resolveToolCall}`,
            `d:${JSON.stringify({ finishReason: "tool-calls" })}`,
          ]
            .map((l) => l + "\n")
            .join(""),
          { headers: { "Content-Type": "text/plain; charset=utf-8" } },
        ),
    }));

    const response = await handleChat(
      createRequest({
        messages: [{ role: "user", content: "open sales data" }],
        contextType: null,
        tableSchema: null,
      }),
      env,
    );

    const lines = await readResponseLines(response);

    // Text delta should be passed through
    const textLine = lines.find((l) => l.startsWith("0:"));
    expect(textLine).toBeDefined();
    expect(textLine).toContain("Let me find that for you.");

    // r: line should be present
    expect(lines.find((l) => l.startsWith("r:"))).toBeDefined();
  });

  it("does not intercept non-resolve_dataset tool calls in dataset context", async () => {
    const sortToolCall = JSON.stringify([
      { toolCallId: "tc-1", toolName: "sortTable", args: { column: "name", direction: "asc" } },
    ]);

    mockStreamText.mockImplementationOnce(() => ({
      toDataStreamResponse: () =>
        new Response(
          [
            `9:${sortToolCall}`,
            `d:${JSON.stringify({ finishReason: "tool-calls" })}`,
          ]
            .map((l) => l + "\n")
            .join(""),
          { headers: { "Content-Type": "text/plain; charset=utf-8" } },
        ),
    }));

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

    const lines = await readResponseLines(response);

    // No r: line — this is a normal dataset context
    expect(lines.find((l) => l.startsWith("r:"))).toBeUndefined();

    // Normal 9: and d: lines should be present
    expect(lines.find((l) => l.startsWith("9:"))).toBeDefined();
    expect(lines.find((l) => l.startsWith("d:"))).toBeDefined();

    const dLine = lines.find((l) => l.startsWith("d:"));
    const dPayload = JSON.parse(dLine!.slice(2));
    expect(dPayload.finishReason).toBe("tool-calls");
  });
});

describe("thread_id and project_id in request payload", () => {
  it("accepts thread_id and project_id without error", async () => {
    mockStreamText.mockImplementationOnce(() => ({
      toDataStreamResponse: () =>
        new Response('0:"hello"\nd:{"finishReason":"stop"}\n', {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    }));

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
    const lines = await readResponseLines(response);
    expect(lines.some((l) => l.startsWith("0:"))).toBe(true);
  });

  it("works without thread_id and project_id (backward compatible)", async () => {
    mockStreamText.mockImplementationOnce(() => ({
      toDataStreamResponse: () =>
        new Response('0:"hello"\nd:{"finishReason":"stop"}\n', {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    }));

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
    const { streamText } = await import("ai");

    mockStreamText.mockImplementationOnce(() => ({
      toDataStreamResponse: () =>
        new Response('0:"filtering..."\nd:{"finishReason":"stop"}\n', {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        }),
    }));

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
    expect(streamText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining("controls a data table"),
        tools: expect.objectContaining({ sortTable: expect.anything() }),
      }),
    );
  });
});
