import { describe, expect, it, vi } from "vitest";

import { handleChat } from "../../lib/chat/handleChat";

// Mock the AI SDK modules since we can't make real Groq API calls in tests
vi.mock("ai", () => ({
  streamText: vi.fn(() => ({
    toDataStreamResponse: () =>
      new Response("0:\"test\"\n", {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
  })),
  tool: vi.fn((opts: unknown) => opts),
}));

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
});
