import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createChatClient } from "@/chat/client";

function sseResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

describe("Chat API", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchChatStream", () => {
    it("sends POST with correct payload", async () => {
      mockFetch.mockResolvedValue(sseResponse("data: {}\n"));
      const client = createChatClient(mockFetch);

      const messages = [{ role: "user", content: "Hello" }];
      const schema = { columns: [{ id: "col1", type: "string" }], rowCount: 5 };
      await client.fetchChatStream(messages, schema);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/chat");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.messages).toEqual(messages);
      expect(body.tableSchema).toEqual(schema);
    });

    it("sends null tableSchema when not provided", async () => {
      mockFetch.mockResolvedValue(sseResponse("data: {}\n"));
      const client = createChatClient(mockFetch);

      await client.fetchChatStream([{ role: "user", content: "Hi" }], null);

      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.tableSchema).toBeNull();
    });

    it("throws on non-ok response", async () => {
      mockFetch.mockResolvedValue(new Response("Server Error", { status: 500 }));
      const client = createChatClient(mockFetch);

      await expect(
        client.fetchChatStream([{ role: "user", content: "Hi" }], null),
      ).rejects.toThrow("HTTP 500");
    });

    it("throws when response has no body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        body: null,
      } as unknown as Response);
      const client = createChatClient(mockFetch);

      await expect(
        client.fetchChatStream([{ role: "user", content: "Hi" }], null),
      ).rejects.toThrow("No response body");
    });
  });
});
