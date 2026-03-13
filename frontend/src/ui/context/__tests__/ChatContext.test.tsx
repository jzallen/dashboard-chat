import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolHandler } from "../../../ui/context/ChatContext";
import {
  ChatProvider,
  useChatContext,
} from "../../../ui/context/ChatContext";

// Mock session API (fire-and-forget, not critical to chat flow).
// The real createChatClient(withEagerAuth(fetch)) captures the fetch reference at module
// load time, before vi.spyOn(globalThis, "fetch") runs in each test. We solve this by
// building the auth-decorated fetch lazily at call time so the spy can intercept it.
vi.mock("@/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/chat")>();
  return {
    ...actual,
    createChatClient: (_fetchFn?: typeof fetch) => {
      // We can't use _fetchFn directly because it was captured before the spy was set up.
      // Instead, build a lazy factory that reads globalThis.fetch at call time, wraps it
      // through the real auth decorator (which uses the already-mocked tokenStorage /
      // tokenRefresh), then delegates to the real createChatClient.
      return {
        createSession: vi.fn().mockResolvedValue({ id: "sess-001" }),
        logTurn: vi.fn().mockResolvedValue(undefined),
        getSession: vi.fn(),
        listSessions: vi.fn(),
        async fetchChatStream(
          apiMessages: Array<{ role: string; content: string }>,
          tableSchema: unknown,
        ): Promise<Response> {
          // Import the real withEagerAuth to add auth headers / token refresh
          const { withEagerAuth } = await import("@/auth");
          // Build a client using the *current* globalThis.fetch (which the test spy has
          // replaced) so assertions on fetch calls work.
          const liveClient = actual.createChatClient(
            withEagerAuth(globalThis.fetch),
          );
          return liveClient.fetchChatStream(
            apiMessages as any,
            tableSchema as any,
          );
        },
      };
    },
  };
});

const mockEnsureFreshToken = vi.fn();

vi.mock("@/auth/tokenStorage", () => ({
  getAuthHeaders: () => ({
    Authorization: `Bearer ${localStorage.getItem("auth_token") ?? "test-token"}`,
  }),
  hardLogout: vi.fn(),
  getToken: () => localStorage.getItem("auth_token") ?? "test-token",
  getRefreshToken: () => localStorage.getItem("auth_refresh_token"),
  getTokenExpiry: () => {
    const val = localStorage.getItem("auth_token_expires_at");
    return val ? Number(val) : null;
  },
  getLastActivity: () => {
    const val = localStorage.getItem("last_activity_ts");
    return val ? Number(val) : null;
  },
  setToken: (v: string) => localStorage.setItem("auth_token", v),
  setRefreshToken: (v: string) => localStorage.setItem("auth_refresh_token", v),
  setTokenExpiry: (v: number) =>
    localStorage.setItem("auth_token_expires_at", String(v)),
  setLastActivity: (v: number) =>
    localStorage.setItem("last_activity_ts", String(v)),
  clearAll: vi.fn(),
  isTokenKey: (key: string | null) => key === "auth_token",
  isExpiryKey: (key: string | null) => key === "auth_token_expires_at",
}));

vi.mock("@/auth/tokenRefresh", () => ({
  ensureFreshToken: (...args: unknown[]) => mockEnsureFreshToken(...args),
  createTokenRefresher:
    () =>
    (...args: unknown[]) =>
      mockEnsureFreshToken(...args),
}));

vi.mock("@/chat/prompts", () => ({
  getSystemPrompt: () => "system prompt",
  getToolDefinitions: () => [],
}));

vi.mock("../../../lib/stream/StreamProvider", () => ({
  useStreamContext: () => ({ client: null, isReady: false }),
}));

vi.mock("../../../lib/stream/useEntityContext", () => ({
  useEntityContext: () => ({
    projectId: null,
    entityType: null,
    entityId: null,
    tableSchema: null,
    setProjectId: vi.fn(),
    setEntityType: vi.fn(),
    setEntityId: vi.fn(),
    setTableSchema: vi.fn(),
  }),
}));

// ---- helpers ----

/** Encodes data as SSE `data: ...` lines. */
function sseLines(
  events: Array<{ type: string; [k: string]: unknown }>,
): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n`).join("\n");
}

/** Creates a ReadableStream from an SSE string. */
function sseStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockFetchSSE(events: Array<{ type: string; [k: string]: unknown }>) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    body: sseStream(sseLines(events)),
  } as unknown as Response);
}

/** Test component that exposes chat context via buttons. */
function TestHarness({ toolHandler }: { toolHandler?: ToolHandler }) {
  const {
    messages,
    input,
    setInput,
    handleSubmit,
    isLoading,
    registerToolHandler,
    registerTableSchema,
  } = useChatContext();

  // Register tool handler on mount
  const registered = (globalThis as any).__chatTestRegistered;
  if (!registered && toolHandler) {
    (globalThis as any).__chatTestRegistered = true;
    registerToolHandler(toolHandler);
    registerTableSchema({
      columns: [{ id: "col1", type: "string" }],
      rowCount: 10,
    });
  }

  return (
    <div>
      <div data-testid="loading">{String(isLoading)}</div>
      <div data-testid="message-count">{messages.length}</div>
      {messages.map((m) => (
        <div key={m.id} data-testid={`msg-${m.role}`}>
          {m.content}
        </div>
      ))}
      <input
        data-testid="chat-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <form onSubmit={handleSubmit}>
        <button type="submit" data-testid="submit">
          Send
        </button>
      </form>
    </div>
  );
}

function renderChat(toolHandler?: ToolHandler) {
  (globalThis as any).__chatTestRegistered = false;
  return render(
    <ChatProvider>
      <TestHarness toolHandler={toolHandler} />
    </ChatProvider>,
  );
}

// ---- tests ----

describe("ChatProvider", () => {
  const defaultToolHandler: ToolHandler = {
    executeToolCall: vi.fn(() => "tool-result"),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    mockEnsureFreshToken.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("starts with no messages", () => {
    renderChat(defaultToolHandler);
    expect(screen.getByTestId("message-count").textContent).toBe("0");
  });

  it("ignores submit with empty input", async () => {
    renderChat(defaultToolHandler);

    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.submit(screen.getByTestId("submit").closest("form")!);
    });

    expect(screen.getByTestId("message-count").textContent).toBe("0");
  });

  it("handles successful SSE content streaming", async () => {
    const fetchSpy = mockFetchSSE([
      { type: "content", content: "Hello " },
      { type: "content", content: "world!" },
      { type: "done" },
    ]);

    renderChat(defaultToolHandler);

    // Type and submit
    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "Hi" },
    });
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.submit(screen.getByTestId("submit").closest("form")!);
    });

    // Wait for streaming to finish
    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // Should have user message + assistant message = 2
    expect(screen.getByTestId("message-count").textContent).toBe("2");
    expect(screen.getByTestId("msg-user").textContent).toBe("Hi");
    expect(screen.getByTestId("msg-assistant").textContent).toBe(
      "Hello world!",
    );

    // Verify fetch was called with correct structure
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/json",
        Authorization: "Bearer test-token",
      }),
    );
  });

  it("handles SSE tool_calls and executes them", async () => {
    const toolHandler: ToolHandler = {
      executeToolCall: vi.fn(() => "applied filter"),
    };

    mockFetchSSE([
      { type: "content", content: "Applying filter..." },
      {
        type: "tool_calls",
        tool_calls: [
          {
            id: "tc-1",
            type: "function",
            function: { name: "addFilter", arguments: '{"col":"a"}' },
          },
        ],
      },
      { type: "done" },
    ]);

    renderChat(toolHandler);

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "Filter col a" },
    });
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.submit(screen.getByTestId("submit").closest("form")!);
    });

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(toolHandler.executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "tc-1",
        function: { name: "addFilter", arguments: '{"col":"a"}' },
      }),
    );
  });

  it("handles SSE error events gracefully", async () => {
    mockFetchSSE([
      { type: "content", content: "Starting..." },
      { type: "error", error: "Model overloaded" },
    ]);

    renderChat(defaultToolHandler);

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "Test" },
    });
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.submit(screen.getByTestId("submit").closest("form")!);
    });

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // The error is caught inside the SSE parsing try/catch — the assistant message
    // should show an error message
    const assistantMsg = screen.getByTestId("msg-assistant");
    expect(assistantMsg.textContent).toContain("Error");
  });

  it("handles fetch failure (network error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network failure"),
    );

    renderChat(defaultToolHandler);

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "Offline test" },
    });
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.submit(screen.getByTestId("submit").closest("form")!);
    });

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("msg-assistant").textContent).toContain(
      "Error: Network failure",
    );
  });

  it("handles HTTP error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    renderChat(defaultToolHandler);

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "Server error" },
    });
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.submit(screen.getByTestId("submit").closest("form")!);
    });

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    expect(screen.getByTestId("msg-assistant").textContent).toContain(
      "Error: HTTP 500",
    );
  });

  it("does not submit when no tool handler is registered", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // No tool handler passed
    renderChat();

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "No handler" },
    });
    // eslint-disable-next-line testing-library/no-unnecessary-act
    await act(async () => {
      fireEvent.submit(screen.getByTestId("submit").closest("form")!);
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId("message-count").textContent).toBe("0");
  });

  describe("stream token resilience", () => {
    it("refreshes token before stream when near expiry", async () => {
      // Token expires in 30 seconds (< 60s threshold)
      localStorage.setItem(
        "auth_token_expires_at",
        String(Date.now() + 30_000),
      );

      mockEnsureFreshToken.mockImplementation(async () => {
        localStorage.setItem("auth_token", "refreshed-token");
        return "refreshed-token";
      });

      const fetchSpy = mockFetchSSE([
        { type: "content", content: "OK" },
        { type: "done" },
      ]);

      renderChat(defaultToolHandler);

      fireEvent.change(screen.getByTestId("chat-input"), {
        target: { value: "Test" },
      });
      // eslint-disable-next-line testing-library/no-unnecessary-act
      await act(async () => {
        fireEvent.submit(screen.getByTestId("submit").closest("form")!);
      });

      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      // ensureFreshToken should have been called for pre-stream check
      expect(mockEnsureFreshToken).toHaveBeenCalledTimes(1);

      // The fetch should use the refreshed token
      const [, init] = fetchSpy.mock.calls[0];
      expect(init?.headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer refreshed-token",
        }),
      );
    });

    it("skips refresh when token is fresh", async () => {
      // Token expires in 5 minutes (> 60s threshold)
      localStorage.setItem(
        "auth_token_expires_at",
        String(Date.now() + 300_000),
      );

      mockFetchSSE([{ type: "content", content: "OK" }, { type: "done" }]);

      renderChat(defaultToolHandler);

      fireEvent.change(screen.getByTestId("chat-input"), {
        target: { value: "Test" },
      });
      // eslint-disable-next-line testing-library/no-unnecessary-act
      await act(async () => {
        fireEvent.submit(screen.getByTestId("submit").closest("form")!);
      });

      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      // No refresh should have been attempted
      expect(mockEnsureFreshToken).not.toHaveBeenCalled();
    });

    it("retries stream once on 401 response", async () => {
      mockEnsureFreshToken.mockResolvedValue("new-token");

      // First call returns 401, second succeeds
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({ ok: false, status: 401 } as Response)
        .mockResolvedValueOnce({
          ok: true,
          body: sseStream(
            sseLines([
              { type: "content", content: "Retried OK" },
              { type: "done" },
            ]),
          ),
        } as unknown as Response);

      renderChat(defaultToolHandler);

      fireEvent.change(screen.getByTestId("chat-input"), {
        target: { value: "Test" },
      });
      // eslint-disable-next-line testing-library/no-unnecessary-act
      await act(async () => {
        fireEvent.submit(screen.getByTestId("submit").closest("form")!);
      });

      await waitFor(() => {
        expect(screen.getByTestId("loading").textContent).toBe("false");
      });

      // Should have called fetch twice (original + retry)
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(mockEnsureFreshToken).toHaveBeenCalledTimes(1);

      // Second call should use the refreshed token
      const [, retryInit] = fetchSpy.mock.calls[1];
      expect(retryInit?.headers).toEqual(
        expect.objectContaining({
          Authorization: "Bearer new-token",
        }),
      );

      expect(screen.getByTestId("msg-assistant").textContent).toBe(
        "Retried OK",
      );
    });
  });
});
