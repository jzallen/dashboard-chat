import { describe, expect, it, vi } from "vitest";

import { handleChat } from "../../lib/chat/handleChat";
import { mockStreamTextResult } from "./_v6Mocks";

// Mock the AI SDK modules — keep `createUIMessageStream` and
// `createUIMessageStreamResponse` real so the v6 SSE pipeline runs end-to-end
// against the synthesized upstream chunks. Only `streamText` (which makes the
// real Groq call) and `tool` (a thin wrapper) need to be replaced.
vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(() =>
      mockStreamTextResult([
        { type: "text-start", id: "m1" },
        { type: "text-delta", id: "m1", delta: "test" },
        { type: "text-end", id: "m1" },
        { type: "finish", finishReason: "stop" },
      ]),
    ),
    tool: vi.fn((opts: unknown) => opts),
  };
});

vi.mock("@ai-sdk/groq", () => ({
  createGroq: () => () => "mock-model",
}));

function createRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const env = { GROQ_API_KEY: "test-key" };

describe("handleChat", () => {
  describe("request validation", () => {
    it("returns 400 when messages is empty", async () => {
      const response = await handleChat(
        createRequest({ messages: [], tableSchema: { columns: [] } }),
        env,
      );
      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("messages");
    });

    it("returns 400 when messages is not an array", async () => {
      const response = await handleChat(
        createRequest({ messages: "not-array" }),
        env,
      );
      expect(response.status).toBe(400);
    });
  });

  describe("context type routing", () => {
    it("accepts null contextType with null tableSchema (conversational mode)", async () => {
      const { streamText } = await import("ai");
      const response = await handleChat(
        createRequest({
          messages: [{ role: "user", content: "hello" }],
          contextType: null,
          contextId: null,
          tableSchema: null,
        }),
        env,
      );

      // Should not return 400
      expect(response.status).not.toBe(400);
      // streamText should have been called without tools
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining("No dataset or view is currently selected"),
        }),
      );
    });

    it("uses dataset tools when contextType is 'dataset' with tableSchema", async () => {
      const { streamText } = await import("ai");
      const response = await handleChat(
        createRequest({
          messages: [{ role: "user", content: "filter by name" }],
          contextType: "dataset",
          contextId: "ds-1",
          tableSchema: {
            columns: [{ id: "name", type: "string" }],
            rowCount: 10,
          },
        }),
        env,
      );

      expect(response.status).not.toBe(400);
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining("controls a data table"),
          tools: expect.objectContaining({ sortTable: expect.anything() }),
        }),
      );
    });

    it("uses report tools when contextType is 'report'", async () => {
      const { streamText } = await import("ai");
      const response = await handleChat(
        createRequest({
          messages: [{ role: "user", content: "add a dimension" }],
          contextType: "report",
          contextId: "r-1",
          tableSchema: {
            columns: [{ id: "region", type: "string" }],
            rowCount: 5,
            layerContext: {
              layer: "report",
              modelName: "monthly_revenue",
              sqlDefinition: "SELECT month, SUM(amount) FROM orders GROUP BY month",
              sourceSchemas: ["int_orders"],
            },
          },
        }),
        env,
      );

      expect(response.status).not.toBe(400);
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining("Report context"),
          tools: expect.objectContaining({ createReport: expect.anything() }),
        }),
      );
      // Should NOT contain dataset or view tools
      const callArgs = (streamText as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(callArgs.tools).not.toHaveProperty("sortTable");
      expect(callArgs.tools).not.toHaveProperty("createView");
    });

    it("uses view tools when contextType is 'view'", async () => {
      const { streamText } = await import("ai");
      const response = await handleChat(
        createRequest({
          messages: [{ role: "user", content: "add a column" }],
          contextType: "view",
          contextId: "v-1",
        }),
        env,
      );

      expect(response.status).not.toBe(400);
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining("View context"),
          tools: expect.objectContaining({ createView: expect.anything() }),
        }),
      );
    });
  });

  describe("temperature override (dc-e8i)", () => {
    it("defaults to 0.3 when env.GROQ_TEMPERATURE is omitted", async () => {
      const { streamText } = await import("ai");
      await handleChat(
        createRequest({
          messages: [{ role: "user", content: "hi" }],
          contextType: null,
          tableSchema: null,
        }),
        env,
      );
      const callArgs = (streamText as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(callArgs.temperature).toBe(0.3);
    });

    it("uses env.GROQ_TEMPERATURE when provided (e.g. 0 for harness determinism)", async () => {
      const { streamText } = await import("ai");
      await handleChat(
        createRequest({
          messages: [{ role: "user", content: "hi" }],
          contextType: null,
          tableSchema: null,
        }),
        { GROQ_API_KEY: "test-key", GROQ_TEMPERATURE: 0 },
      );
      const callArgs = (streamText as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0];
      expect(callArgs.temperature).toBe(0);
    });
  });
});
