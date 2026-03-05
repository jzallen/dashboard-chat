import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatTurnPayload } from "../../lib/chat/client";
import { createChatClient } from "../../lib/chat/client";
import { ApiError } from "../../lib/shared/apiClient";

const MOCK_SESSION = {
  id: "sess-001",
  project_id: "proj-001",
  dataset_id: "ds-001",
  turns: [],
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/plain" },
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

  describe("createSession", () => {
    it("sends POST with correct payload", async () => {
      mockFetch.mockResolvedValue(jsonResponse(MOCK_SESSION));
      const client = createChatClient(mockFetch);

      const result = await client.createSession("proj-001", "ds-001");

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/sessions");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ project_id: "proj-001", dataset_id: "ds-001" });
      expect(result).toEqual(MOCK_SESSION);
    });

    it("sends null dataset_id when not provided", async () => {
      mockFetch.mockResolvedValue(jsonResponse(MOCK_SESSION));
      const client = createChatClient(mockFetch);

      await client.createSession("proj-001");

      const body = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
      expect(body.dataset_id).toBeNull();
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(textResponse("Server Error", 500));
      const client = createChatClient(mockFetch);

      await expect(client.createSession("proj-001", "ds-001")).rejects.toThrow(
        ApiError,
      );
      try {
        mockFetch.mockResolvedValue(textResponse("Server Error", 500));
        await client.createSession("proj-001", "ds-001");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(500);
      }
    });
  });

  describe("logTurn", () => {
    const turnPayload: ChatTurnPayload = {
      user_message: "Hello",
      system_prompt: "You are helpful",
      tool_definitions: [],
      assistant_content: "Hi there!",
      tool_calls: null,
      tool_results: null,
      table_schema: { columns: [], rowCount: 0 },
    };

    it("sends POST to correct session turns endpoint", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      const client = createChatClient(mockFetch);

      await client.logTurn("sess-001", turnPayload);

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/sessions/sess-001/turns");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.user_message).toBe("Hello");
      expect(body.assistant_content).toBe("Hi there!");
    });

    it("throws ApiError on non-ok response", async () => {
      mockFetch.mockResolvedValue(textResponse("Not Found", 404));
      const client = createChatClient(mockFetch);

      await expect(client.logTurn("sess-001", turnPayload)).rejects.toThrow(
        ApiError,
      );
    });
  });

  describe("getSession", () => {
    it("sends GET request", async () => {
      mockFetch.mockResolvedValue(jsonResponse(MOCK_SESSION));
      const client = createChatClient(mockFetch);

      const result = await client.getSession("sess-001");

      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toContain("/sessions/sess-001");
      expect(init?.method).toBe("GET");
      expect(result.id).toBe("sess-001");
    });
  });

  describe("listSessions", () => {
    it("sends GET with dataset_id query param", async () => {
      mockFetch.mockResolvedValue(jsonResponse([MOCK_SESSION]));
      const client = createChatClient(mockFetch);

      const result = await client.listSessions("ds-001");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("dataset_id=ds-001");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("sess-001");
    });

    it("encodes special characters in dataset_id", async () => {
      mockFetch.mockResolvedValue(jsonResponse([]));
      const client = createChatClient(mockFetch);

      await client.listSessions("ds/special&id");

      const url = mockFetch.mock.calls[0][0] as string;
      expect(url).toContain("dataset_id=ds%2Fspecial%26id");
    });
  });
});
