import { describe, expect,it } from "vitest";

import {
  ChatClient,
  ChatCompletionRequest,
  handleChat,
} from "../../lib/chat";

interface StreamChunk {
  delta?: {
    content?: string;
    tool_calls?: Array<{
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  };
  finish_reason?: string | null;
}

function createMockClient(chunks: StreamChunk[]): ChatClient {
  return {
    async *streamCompletion(
      _request: ChatCompletionRequest
    ): AsyncGenerator<string> {
      for (const chunk of chunks) {
        yield JSON.stringify({
          choices: [{ delta: chunk.delta, finish_reason: chunk.finish_reason }],
        });
      }
    },
  };
}

function createChatRequest(): Request {
  return new Request("http://localhost/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "test" }],
      tableSchema: {
        columns: [
          { id: "id", type: "string" },
          { id: "name", type: "string" },
        ],
        rowCount: 3,
      },
    }),
  });
}

describe("handleChat", () => {
  describe("response formatting", () => {
    it("should format content chunks as SSE content events", async () => {
      const client = createMockClient([
        { delta: { content: "Hello" } },
        { delta: { content: " world" } },
        { delta: {}, finish_reason: "stop" },
      ]);

      const response = await handleChat(createChatRequest(), client);
      const text = await response.text();

      expect(text).toBe(
        'data: {"type":"content","content":"Hello"}\n\n' +
          'data: {"type":"content","content":" world"}\n\n' +
          'data: {"type":"done"}\n\n'
      );
    });

    it("should aggregate tool_calls chunks as SSE tool_calls event", async () => {
      const client = createMockClient([
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_abc",
                function: { name: "filterTable", arguments: "" },
              },
            ],
          },
        },
        {
          delta: {
            tool_calls: [
              { index: 0, function: { arguments: '{"column":"name"}' } },
            ],
          },
        },
        { delta: {}, finish_reason: "tool_calls" },
      ]);

      const response = await handleChat(createChatRequest(), client);
      const text = await response.text();

      const expectedToolCalls = {
        type: "tool_calls",
        tool_calls: [
          {
            id: "call_abc",
            type: "function",
            function: { name: "filterTable", arguments: '{"column":"name"}' },
          },
        ],
      };

      expect(text).toBe(
        `data: ${JSON.stringify(expectedToolCalls)}\n\n` +
          'data: {"type":"done"}\n\n'
      );
    });

    it("should emit done event when finish_reason is present", async () => {
      const client = createMockClient([{ delta: {}, finish_reason: "stop" }]);

      const response = await handleChat(createChatRequest(), client);
      const text = await response.text();

      expect(text).toBe('data: {"type":"done"}\n\n');
    });
  });

  describe("response headers", () => {
    it("should return SSE content type header", async () => {
      const client = createMockClient([{ delta: {}, finish_reason: "stop" }]);

      const response = await handleChat(createChatRequest(), client);

      expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    });

    it("should return cache control headers for streaming", async () => {
      const client = createMockClient([{ delta: {}, finish_reason: "stop" }]);

      const response = await handleChat(createChatRequest(), client);

      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Connection")).toBe("keep-alive");
    });
  });
});
