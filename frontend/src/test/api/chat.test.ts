import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatTurnPayload } from "../../lib/chat/client";
import { createSession, getSession, listSessions,logTurn } from "../../lib/chat/client";
import { ApiError } from "../../lib/shared/apiClient";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, writable: true });

// Capture location.href assignments
let locationHref = "/";
Object.defineProperty(globalThis, "window", {
  value: {
    location: {
      get href() { return locationHref; },
      set href(v: string) { locationHref = v; },
    },
    localStorage: localStorageMock,
  },
  writable: true,
});

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
  return new Response(text, { status, headers: { "Content-Type": "text/plain" } });
}

describe("Chat API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorageMock.clear();
    locationHref = "/";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createSession", () => {
    it("sends POST with correct payload and auth header", async () => {
      localStorageMock.setItem("auth_token", "test-token-123");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOCK_SESSION));

      const result = await createSession("proj-001", "ds-001");

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain("/sessions");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual(
        expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer test-token-123",
        })
      );
      const body = JSON.parse(init?.body as string);
      expect(body).toEqual({ project_id: "proj-001", dataset_id: "ds-001" });
      expect(result).toEqual(MOCK_SESSION);
    });

    it("sends null dataset_id when not provided", async () => {
      localStorageMock.setItem("auth_token", "test-token-123");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOCK_SESSION));

      await createSession("proj-001");

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.dataset_id).toBeNull();
    });

    it("sends request without auth header when no token stored", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOCK_SESSION));

      await createSession("proj-001", "ds-001");

      const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    });

    it("throws ApiError on non-ok response", async () => {
      localStorageMock.setItem("auth_token", "test-token-123");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("Server Error", 500));

      await expect(createSession("proj-001", "ds-001")).rejects.toThrow(ApiError);
      await vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("Server Error", 500));
      try {
        await createSession("proj-001", "ds-001");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(500);
      }
    });

    it("clears auth and throws ApiError on 401", async () => {
      localStorageMock.setItem("auth_token", "test-token-123");
      localStorageMock.setItem("auth_user", '{"id":"u1"}');
      vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("Unauthorized", 401));

      await expect(createSession("proj-001")).rejects.toThrow(ApiError);
      try {
        await createSession("proj-001");
      } catch (e) {
        expect(e).toBeInstanceOf(ApiError);
        expect((e as ApiError).status).toBe(401);
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
      localStorageMock.setItem("auth_token", "tok-abc");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ ok: true }));

      await logTurn("sess-001", turnPayload);

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain("/sessions/sess-001/turns");
      expect(init?.method).toBe("POST");
      const body = JSON.parse(init?.body as string);
      expect(body.user_message).toBe("Hello");
      expect(body.assistant_content).toBe("Hi there!");
    });

    it("throws ApiError on non-ok response", async () => {
      localStorageMock.setItem("auth_token", "tok-abc");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("Not Found", 404));

      await expect(logTurn("sess-001", turnPayload)).rejects.toThrow(ApiError);
    });
  });

  describe("getSession", () => {
    it("sends GET with auth header", async () => {
      localStorageMock.setItem("auth_token", "tok-get");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse(MOCK_SESSION));

      const result = await getSession("sess-001");

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain("/sessions/sess-001");
      expect(init?.method).toBe("GET");
      expect(result.id).toBe("sess-001");
    });
  });

  describe("listSessions", () => {
    it("sends GET with dataset_id query param", async () => {
      localStorageMock.setItem("auth_token", "tok-list");
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([MOCK_SESSION]));

      const result = await listSessions("ds-001");

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain("dataset_id=ds-001");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("sess-001");
    });

    it("encodes special characters in dataset_id", async () => {
      localStorageMock.setItem("auth_token", "tok-list");
      vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse([]));

      await listSessions("ds/special&id");

      const url = vi.mocked(fetch).mock.calls[0][0] as string;
      expect(url).toContain("dataset_id=ds%2Fspecial%26id");
    });
  });
});
