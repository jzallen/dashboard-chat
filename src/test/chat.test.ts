import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  handleChat,
  ChatClient,
  ChatCompletionRequest,
} from "../lib/chat/index";

type StreamChunk =
  | { content: string }
  | { tool_calls: Array<{ index: number; id?: string; function: { name?: string; arguments?: string } }> }
  | { finish_reason: string };

function createMockClient(
  chunks: StreamChunk[]
): ChatClient & { lastRequest: ChatCompletionRequest | null } {
  const client = {
    lastRequest: null as ChatCompletionRequest | null,
    async *streamCompletion(
      request: ChatCompletionRequest
    ): AsyncGenerator<string> {
      client.lastRequest = request;
      for (const chunk of chunks) {
        let delta: Record<string, unknown> = {};
        let finishReason: string | null = null;

        if ("content" in chunk) {
          delta = { content: chunk.content };
        } else if ("tool_calls" in chunk) {
          delta = { tool_calls: chunk.tool_calls };
        } else if ("finish_reason" in chunk) {
          finishReason = chunk.finish_reason;
        }

        yield JSON.stringify({
          choices: [{ delta, finish_reason: finishReason }],
        });
      }
    },
  };
  return client;
}

function createChatRequest(userMessage: string) {
  return new Request("http://localhost/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: userMessage }],
      tableSchema: {
        columns: [
          { id: "id", type: "string" },
          { id: "name", type: "string" },
          { id: "amount", type: "number" },
        ],
        rowCount: 5,
      },
    }),
  });
}

describe("handleChat", () => {
  describe("request forwarding", () => {
    it("should include system prompt in AI call", async () => {
      const client = createMockClient([
        { content: "Response" },
        { finish_reason: "stop" },
      ]);

      await handleChat(createChatRequest("Filter by name"), client);

      expect(client.lastRequest).not.toBeNull();
      expect(client.lastRequest!.messages[0].role).toBe("system");
      expect(client.lastRequest!.messages[0].content).toContain(
        "helpful assistant"
      );
    });

    it("should include user messages in AI call", async () => {
      const client = createMockClient([
        { content: "Response" },
        { finish_reason: "stop" },
      ]);

      await handleChat(createChatRequest("Filter by name"), client);

      expect(client.lastRequest!.messages[1].role).toBe("user");
      expect(client.lastRequest!.messages[1].content).toBe("Filter by name");
    });

    it("should include tool definitions in AI call", async () => {
      const client = createMockClient([
        { content: "Response" },
        { finish_reason: "stop" },
      ]);

      await handleChat(createChatRequest("Filter by name"), client);

      expect(client.lastRequest!.tools.length).toBeGreaterThan(0);
      expect(
        client.lastRequest!.tools.some((t) => t.name === "filterTable")
      ).toBe(true);
    });
  });

  describe("SSE streaming", () => {
    it("should return SSE-formatted content events", async () => {
      const client = createMockClient([
        { content: "Hello" },
        { content: " world" },
        { finish_reason: "stop" },
      ]);

      const response = await handleChat(createChatRequest("Hi"), client);
      const text = await response.text();

      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
      expect(text).toBe(
        'data: {"type":"content","content":"Hello"}\n\n' +
          'data: {"type":"content","content":" world"}\n\n' +
          'data: {"type":"done"}\n\n'
      );
    });

    it("should emit tool_calls events when AI requests tools", async () => {
      const client = createMockClient([
        {
          tool_calls: [
            {
              index: 0,
              id: "call_123",
              function: { name: "filterTable", arguments: "" },
            },
          ],
        },
        {
          tool_calls: [
            { index: 0, function: { arguments: '{"column":"name"}' } },
          ],
        },
        { finish_reason: "tool_calls" },
      ]);

      const response = await handleChat(
        createChatRequest("Filter by name"),
        client
      );
      const text = await response.text();

      expect(text).toContain('"type":"tool_calls"');
      expect(text).toContain("filterTable");
      expect(text).toContain('"type":"done"');
    });

    it("should include CORS headers", async () => {
      const client = createMockClient([{ finish_reason: "stop" }]);

      const response = await handleChat(createChatRequest("Hi"), client);

      expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(response.headers.get("Access-Control-Allow-Methods")).toContain(
        "POST"
      );
    });
  });
});

describe("GroqChatClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should call Groq API with correct endpoint and auth", async () => {
    const { createChatHandler } = await import("../lib/chat/index");
    const mockFetch = vi.fn();

    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
          )
        );
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({ ok: true, body: mockStream });
    vi.stubGlobal("fetch", mockFetch);

    const handler = createChatHandler({ GROQ_API_KEY: "test-api-key" });
    await handler(createChatRequest("Hello"));

    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.groq.com/openai/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-api-key",
        }),
      })
    );
  });

  it("should stream response chunks from Groq API", async () => {
    const { createChatHandler } = await import("../lib/chat/index");

    const mockStream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":" world"},"finish_reason":null}]}\n\n'
          )
        );
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'
          )
        );
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, body: mockStream })
    );

    const handler = createChatHandler({ GROQ_API_KEY: "test-api-key" });
    const response = await handler(createChatRequest("Hi"));
    const text = await response.text();

    expect(text).toBe(
      'data: {"type":"content","content":"Hello"}\n\n' +
        'data: {"type":"content","content":" world"}\n\n' +
        'data: {"type":"done"}\n\n'
    );
  });

  it("should handle Groq API errors", async () => {
    const { createChatHandler } = await import("../lib/chat/index");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      })
    );

    const handler = createChatHandler({ GROQ_API_KEY: "bad-key" });
    const response = await handler(createChatRequest("Hi"));
    const text = await response.text();

    expect(text).toContain('"type":"error"');
    expect(text).toContain("Groq API error: 401");
  });
});
