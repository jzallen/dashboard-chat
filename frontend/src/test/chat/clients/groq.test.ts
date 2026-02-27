import { beforeEach,describe, expect, it, vi } from "vitest";

import { GroqChatClient } from "@/chat/clients/groq";

// --- Utility Functions ---

function sseResponse(chunks: string[]): Response {
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

function sseChunk(content: string): string {
  return `data: {"choices":[{"delta":{"content":"${content}"}}]}\n\n`;
}

function errorResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

async function collectStream(
  generator: AsyncGenerator<string>
): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of generator) {
    chunks.push(chunk);
  }
  return chunks;
}

// --- Expected Fetch Init ---

function expectedFetchInit(
  apiMessages: unknown[],
  apiTools: unknown[]
): RequestInit {
  return {
    method: "POST",
    headers: {
      Authorization: "Bearer test-api-key",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: apiMessages,
      tools: apiTools,
      tool_choice: "auto",
      stream: true,
      temperature: 0.4,
      max_tokens: 1024,
    }),
  };
}

// --- Shared Fetch Fixture ---

function createMockFetch(expectedInit: RequestInit, response: Response) {
  return (url: string, options: RequestInit): Promise<Response> => {
    if (!url.endsWith("/chat/completions")) {
      throw new Error(
        `Unexpected endpoint: ${url}. Expected /chat/completions`
      );
    }

    if (JSON.stringify(options) !== JSON.stringify(expectedInit)) {
      throw new Error(
        `Request mismatch.\n` +
          `Expected: ${JSON.stringify(expectedInit, null, 2)}\n` +
          `Received: ${JSON.stringify(options, null, 2)}`
      );
    }

    return Promise.resolve(response);
  };
}

// --- Tests ---

describe("GroqChatClient", () => {
  const client = new GroqChatClient("test-api-key");

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("streaming responses", () => {
    it("yields content from single chunk", async () => {
      vi.stubGlobal(
        "fetch",
        createMockFetch(
          expectedFetchInit(
            [
              {
                role: "user",
                content: "hello",
                tool_calls: undefined,
                tool_call_id: undefined,
              },
            ],
            []
          ),
          sseResponse([sseChunk("Hello"), "data: [DONE]\n"])
        )
      );

      const output = await collectStream(
        client.streamCompletion({
          messages: [{ role: "user", content: "hello" }],
          tools: [],
        })
      );

      expect(output).toEqual(['{"choices":[{"delta":{"content":"Hello"}}]}']);
    });

    it("yields multiple chunks in order", async () => {
      vi.stubGlobal(
        "fetch",
        createMockFetch(
          expectedFetchInit(
            [
              {
                role: "user",
                content: "hello",
                tool_calls: undefined,
                tool_call_id: undefined,
              },
            ],
            []
          ),
          sseResponse([sseChunk("Hello"), sseChunk(" world"), "data: [DONE]\n"])
        )
      );

      const output = await collectStream(
        client.streamCompletion({
          messages: [{ role: "user", content: "hello" }],
          tools: [],
        })
      );

      expect(output).toEqual([
        '{"choices":[{"delta":{"content":"Hello"}}]}',
        '{"choices":[{"delta":{"content":" world"}}]}',
      ]);
    });

    it("stops at [DONE] message", async () => {
      vi.stubGlobal(
        "fetch",
        createMockFetch(
          expectedFetchInit(
            [
              {
                role: "user",
                content: "hello",
                tool_calls: undefined,
                tool_call_id: undefined,
              },
            ],
            []
          ),
          sseResponse([
            sseChunk("Before"),
            "data: [DONE]\n\n",
            sseChunk("After"),
          ])
        )
      );

      const output = await collectStream(
        client.streamCompletion({
          messages: [{ role: "user", content: "hello" }],
          tools: [],
        })
      );

      expect(output).toEqual(['{"choices":[{"delta":{"content":"Before"}}]}']);
    });

    it("handles partial lines buffered across chunks", async () => {
      vi.stubGlobal(
        "fetch",
        createMockFetch(
          expectedFetchInit(
            [
              {
                role: "user",
                content: "hello",
                tool_calls: undefined,
                tool_call_id: undefined,
              },
            ],
            []
          ),
          sseResponse([
            'data: {"choices":[{"delta"',
            ':{"content":"buffered"}}]}\n\n',
            "data: [DONE]\n",
          ])
        )
      );

      const output = await collectStream(
        client.streamCompletion({
          messages: [{ role: "user", content: "hello" }],
          tools: [],
        })
      );

      expect(output).toEqual([
        '{"choices":[{"delta":{"content":"buffered"}}]}',
      ]);
    });

    it("handles multiple data lines in single network chunk", async () => {
      vi.stubGlobal(
        "fetch",
        createMockFetch(
          expectedFetchInit(
            [
              {
                role: "user",
                content: "hello",
                tool_calls: undefined,
                tool_call_id: undefined,
              },
            ],
            []
          ),
          sseResponse([sseChunk("one") + sseChunk("two"), "data: [DONE]\n"])
        )
      );

      const output = await collectStream(
        client.streamCompletion({
          messages: [{ role: "user", content: "hello" }],
          tools: [],
        })
      );

      expect(output).toEqual([
        '{"choices":[{"delta":{"content":"one"}}]}',
        '{"choices":[{"delta":{"content":"two"}}]}',
      ]);
    });
  });

  describe("tool transformation", () => {
    it("transforms ToolDefinition[] to OpenAI function format", async () => {
      const toolDefinitions = [
        {
          name: "filterTable",
          description: "Filter table rows",
          parameters: {
            type: "object",
            properties: {
              column: { type: "string" },
              value: { type: "string" },
            },
            required: ["column", "value"],
          },
        },
        {
          name: "sortTable",
          description: "Sort table by column",
          parameters: {
            type: "object",
            properties: {
              column: { type: "string" },
              direction: { type: "string", enum: ["asc", "desc"] },
            },
            required: ["column", "direction"],
          },
        },
      ];

      const expectedApiTools = [
        {
          type: "function",
          function: {
            name: "filterTable",
            description: "Filter table rows",
            parameters: {
              type: "object",
              properties: {
                column: { type: "string" },
                value: { type: "string" },
              },
              required: ["column", "value"],
            },
          },
        },
        {
          type: "function",
          function: {
            name: "sortTable",
            description: "Sort table by column",
            parameters: {
              type: "object",
              properties: {
                column: { type: "string" },
                direction: { type: "string", enum: ["asc", "desc"] },
              },
              required: ["column", "direction"],
            },
          },
        },
      ];

      vi.stubGlobal(
        "fetch",
        createMockFetch(
          expectedFetchInit(
            [
              {
                role: "user",
                content: "filter by name",
                tool_calls: undefined,
                tool_call_id: undefined,
              },
            ],
            expectedApiTools
          ),
          sseResponse([sseChunk("Filtering"), "data: [DONE]\n"])
        )
      );

      const output = await collectStream(
        client.streamCompletion({
          messages: [{ role: "user", content: "filter by name" }],
          tools: toolDefinitions,
        })
      );

      expect(output).toEqual(['{"choices":[{"delta":{"content":"Filtering"}}]}']);
    });
  });

  describe("error responses", () => {
    it("throws with status and message on API error", async () => {
      vi.stubGlobal(
        "fetch",
        createMockFetch(
          expectedFetchInit(
            [
              {
                role: "user",
                content: "hello",
                tool_calls: undefined,
                tool_call_id: undefined,
              },
            ],
            []
          ),
          errorResponse(401, "Invalid API key")
        )
      );

      await expect(
        collectStream(
          client.streamCompletion({
            messages: [{ role: "user", content: "hello" }],
            tools: [],
          })
        )
      ).rejects.toThrow("Groq API error: 401 - Invalid API key");
    });

    it("throws when response body is missing", async () => {
      vi.stubGlobal(
        "fetch",
        createMockFetch(
          expectedFetchInit(
            [
              {
                role: "user",
                content: "hello",
                tool_calls: undefined,
                tool_call_id: undefined,
              },
            ],
            []
          ),
          new Response(null, { status: 200 })
        )
      );

      await expect(
        collectStream(
          client.streamCompletion({
            messages: [{ role: "user", content: "hello" }],
            tools: [],
          })
        )
      ).rejects.toThrow("No response body");
    });
  });
});
