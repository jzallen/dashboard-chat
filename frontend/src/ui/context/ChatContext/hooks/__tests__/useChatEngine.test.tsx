import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatProvider, useChatContext } from "../useChatEngine";

// --- Mocks (same pattern as ChatContext.test.tsx) ---

const mockFetchChatStream = vi.fn().mockResolvedValue({
  ok: true,
  body: new ReadableStream({
    start(controller) {
      controller.close();
    },
  }),
});

vi.mock("@/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/chat")>();
  return {
    ...actual,
    createChatClient: () => ({
      createSession: vi.fn().mockResolvedValue({ id: "sess-001" }),
      logTurn: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn(),
      listSessions: vi.fn(),
      fetchChatStream: (...args: unknown[]) => mockFetchChatStream(...args),
    }),
  };
});

vi.mock("@/auth", () => ({
  withEagerAuth: (f: typeof fetch) => f,
}));

vi.mock("../../../../../core/auth/tokenStorage", () => ({
  getAuthHeaders: () => ({ Authorization: "Bearer test-token" }),
  hardLogout: vi.fn(),
  getToken: () => "test-token",
  getRefreshToken: () => null,
  getTokenExpiry: () => null,
  getLastActivity: () => null,
  setToken: vi.fn(),
  setRefreshToken: vi.fn(),
  setTokenExpiry: vi.fn(),
  setLastActivity: vi.fn(),
  clearAll: vi.fn(),
  isTokenKey: () => false,
  isExpiryKey: () => false,
}));

vi.mock("../../../../../core/auth/tokenRefresh", () => ({
  ensureFreshToken: vi.fn().mockResolvedValue(null),
  createTokenRefresher: () => vi.fn().mockResolvedValue(null),
}));

vi.mock("@/chat/prompts", () => ({
  getSystemPrompt: () => "system prompt",
  getToolDefinitions: () => [],
}));

const mockUseStreamContext = vi.fn(() => ({ client: null, isReady: false }));
vi.mock("../../../../../lib/stream/StreamProvider", () => ({
  useStreamContext: (...args: unknown[]) => mockUseStreamContext(...args),
}));

vi.mock("../../../../../lib/stream/useEntityContext", () => ({
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

// --- Test harness ---

function TestHarness() {
  const ctx = useChatContext();

  return (
    <div>
      <div data-testid="message-count">{ctx.messages.length}</div>
      <div data-testid="is-active">{String(ctx.isActive)}</div>
      <div data-testid="input">{ctx.input}</div>
      {ctx.messages.map((m) => (
        <div key={m.id} data-testid={`msg-${m.id}`}>
          {m.content}
        </div>
      ))}
      <button
        data-testid="register-handler"
        onClick={() =>
          ctx.registerToolHandler({ executeToolCall: () => "result" })
        }
      />
      <button
        data-testid="unregister-handler"
        onClick={() => ctx.registerToolHandler(null)}
      />
      <button
        data-testid="register-schema"
        onClick={() =>
          ctx.registerTableSchema({ columns: [{ id: "c1", type: "string" }], rowCount: 5 })
        }
      />
      <button
        data-testid="add-message"
        onClick={() =>
          ctx.addMessage({ id: "custom-1", role: "user", content: "Added message" })
        }
      />
      <button
        data-testid="reset-session"
        onClick={() => ctx.resetSession()}
      />
      <button
        data-testid="register-dataset-id"
        onClick={() => ctx.registerDatasetId("ds-1")}
      />
      <button
        data-testid="register-project-id"
        onClick={() => ctx.registerProjectId("p-1")}
      />
      <button
        data-testid="on-dataset-created"
        onClick={() =>
          ctx.onDatasetCreated({
            id: "ds-new",
            project_id: "p-1",
            name: "New",
            description: null,
            schema_config: { fields: {} },
            partition_fields: [],
            transforms: [],
            preview_rows: [],
            column_profiles: null,
          })
        }
      />
      <button
        data-testid="set-input"
        onClick={() => ctx.setInput("typed text")}
      />
    </div>
  );
}

function renderEngine() {
  return render(
    <ChatProvider>
      <TestHarness />
    </ChatProvider>,
  );
}

// --- Tests ---

describe("useChatEngine — registration and state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts inactive with no messages", () => {
    renderEngine();

    expect(screen.getByTestId("is-active").textContent).toBe("false");
    expect(screen.getByTestId("message-count").textContent).toBe("0");
  });

  it("becomes active when tool handler is registered", async () => {
    renderEngine();

    await act(async () => {
      screen.getByTestId("register-handler").click();
    });

    expect(screen.getByTestId("is-active").textContent).toBe("true");
  });

  it("becomes inactive when tool handler is unregistered", async () => {
    renderEngine();

    await act(async () => {
      screen.getByTestId("register-handler").click();
    });
    expect(screen.getByTestId("is-active").textContent).toBe("true");

    await act(async () => {
      screen.getByTestId("unregister-handler").click();
    });
    expect(screen.getByTestId("is-active").textContent).toBe("false");
  });

  it("addMessage appends to message list", async () => {
    renderEngine();

    await act(async () => {
      screen.getByTestId("add-message").click();
    });

    expect(screen.getByTestId("message-count").textContent).toBe("1");
    expect(screen.getByTestId("msg-custom-1").textContent).toBe("Added message");
  });

  it("resetSession clears all messages", async () => {
    renderEngine();

    // Add messages
    await act(async () => {
      screen.getByTestId("add-message").click();
    });
    expect(screen.getByTestId("message-count").textContent).toBe("1");

    // Reset
    await act(async () => {
      screen.getByTestId("reset-session").click();
    });
    expect(screen.getByTestId("message-count").textContent).toBe("0");
  });

  it("setInput updates the input value", async () => {
    renderEngine();

    await act(async () => {
      screen.getByTestId("set-input").click();
    });

    expect(screen.getByTestId("input").textContent).toBe("typed text");
  });

  it("onDatasetCreated calls registered project updater", async () => {
    const updater = vi.fn();

    function HarnessWithUpdater() {
      const ctx = useChatContext();

      return (
        <div>
          <button
            data-testid="register-updater"
            onClick={() => ctx.registerProjectUpdater(updater)}
          />
          <button
            data-testid="create-dataset"
            onClick={() =>
              ctx.onDatasetCreated({
                id: "ds-new",
                project_id: "p-1",
                name: "New",
                description: null,
                schema_config: { fields: {} },
                partition_fields: [],
                transforms: [],
                preview_rows: [],
                column_profiles: null,
              })
            }
          />
        </div>
      );
    }

    render(
      <ChatProvider>
        <HarnessWithUpdater />
      </ChatProvider>,
    );

    await act(async () => {
      screen.getByTestId("register-updater").click();
    });

    await act(async () => {
      screen.getByTestId("create-dataset").click();
    });

    expect(updater).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ds-new", name: "New" }),
    );
  });

  it("onDatasetCreated does nothing without registered updater", async () => {
    renderEngine();

    // Should not throw
    await act(async () => {
      screen.getByTestId("on-dataset-created").click();
    });

    // No error means success
    expect(screen.getByTestId("message-count").textContent).toBe("0");
  });

  it("useChatContext throws outside ChatProvider", () => {
    function Orphan() {
      useChatContext();
      return null;
    }

    expect(() => render(<Orphan />)).toThrow(
      "useChatContext must be used within a ChatProvider",
    );
  });

  it("does not expose isFrozen in context value", () => {
    let contextValue: ReturnType<typeof useChatContext> | null = null;

    function Inspector() {
      contextValue = useChatContext();
      return null;
    }

    render(
      <ChatProvider>
        <Inspector />
      </ChatProvider>,
    );

    expect(contextValue).not.toBeNull();
    expect("isFrozen" in contextValue!).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Stream integration tests
// ---------------------------------------------------------------------------

describe("useChatEngine — Stream integration", () => {
  beforeEach(() => {
    // Reset to defaults without restoring module-level mocks
    mockUseStreamContext.mockReturnValue({ client: null, isReady: false });
    mockFetchChatStream.mockReset().mockResolvedValue({
      ok: true,
      body: new ReadableStream({ start(c) { c.close(); } }),
    });
  });

  it("buildApiMessages hydrates from Stream channel when available", async () => {
    // Override the StreamProvider mock for this test
    const mockSendMessage = vi.fn().mockResolvedValue({});
    const mockChannel = {
      state: {
        messages: [
          { id: "m1", text: "hello", user: { id: "user-1" } },
          { id: "m2", text: "world", user: { id: "assistant" } },
        ],
      },
      sendMessage: mockSendMessage,
    };

    mockUseStreamContext.mockReturnValue({
      client: null,
      isReady: true,
    });

    // Capture API messages passed to fetchChatStream
    let capturedMessages: any = null;
    mockFetchChatStream.mockImplementation(async (apiMessages: unknown) => {
      capturedMessages = apiMessages;
      return {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ type: "content", content: "OK" })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`),
            );
            controller.close();
          },
        }),
      };
    });

    function StreamTestHarness() {
      const ctx = useChatContext();
      return (
        <div>
          <div data-testid="loading">{String(ctx.isLoading)}</div>
          <div data-testid="message-count">{ctx.messages.length}</div>
          <input
            data-testid="chat-input"
            value={ctx.input}
            onChange={(e) => ctx.setInput(e.target.value)}
          />
          <form onSubmit={ctx.handleSubmit}>
            <button type="submit" data-testid="submit">Send</button>
          </form>
          <button
            data-testid="register-handler"
            onClick={() => ctx.registerToolHandler({ executeToolCall: () => "result" })}
          />
          <button
            data-testid="register-channel"
            onClick={() => ctx.registerCurrentChannel(mockChannel as any)}
          />
        </div>
      );
    }

    render(
      <ChatProvider>
        <StreamTestHarness />
      </ChatProvider>,
    );

    // Register handler and channel
    await act(async () => {
      screen.getByTestId("register-handler").click();
      screen.getByTestId("register-channel").click();
    });

    // Type and submit
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "test" } });
    fireEvent.submit(screen.getByTestId("submit").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // The API call should have included Stream channel history
    expect(capturedMessages).not.toBeNull();
    expect(capturedMessages).toHaveLength(3); // 2 from channel + 1 user message
    expect(capturedMessages[0]).toEqual(
      expect.objectContaining({ role: "user", content: "hello" }),
    );
    expect(capturedMessages[1]).toEqual(
      expect.objectContaining({ role: "assistant", content: "world" }),
    );
    expect(capturedMessages[2]).toEqual(
      expect.objectContaining({ role: "user", content: "test" }),
    );
  });

  it("writeToStream calls channel.sendMessage after SSE completion", async () => {
    const mockSendMessage = vi.fn().mockResolvedValue({});
    const mockChannel = {
      state: { messages: [] },
      sendMessage: mockSendMessage,
    };

    mockUseStreamContext.mockReturnValue({
      client: null,
      isReady: true,
    });

    mockFetchChatStream.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "content", content: "Reply" })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`),
          );
          controller.close();
        },
      }),
    });

    function StreamWriteHarness() {
      const ctx = useChatContext();
      return (
        <div>
          <div data-testid="loading">{String(ctx.isLoading)}</div>
          <input
            data-testid="chat-input"
            value={ctx.input}
            onChange={(e) => ctx.setInput(e.target.value)}
          />
          <form onSubmit={ctx.handleSubmit}>
            <button type="submit" data-testid="submit">Send</button>
          </form>
          <button
            data-testid="register-handler"
            onClick={() => ctx.registerToolHandler({ executeToolCall: () => "result" })}
          />
          <button
            data-testid="register-channel"
            onClick={() => ctx.registerCurrentChannel(mockChannel as any)}
          />
        </div>
      );
    }

    render(
      <ChatProvider>
        <StreamWriteHarness />
      </ChatProvider>,
    );

    await act(async () => {
      screen.getByTestId("register-handler").click();
      screen.getByTestId("register-channel").click();
    });

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "hi" } });
    fireEvent.submit(screen.getByTestId("submit").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // Wait for async writeToStream calls to complete
    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledTimes(2);
    });

    // First call: user message
    expect(mockSendMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({ text: "hi" }),
    );
    // Second call: assistant message
    expect(mockSendMessage.mock.calls[1][0]).toEqual(
      expect.objectContaining({ text: "Reply", user_id: "assistant" }),
    );
  });

  it("writeToStream is a no-op when Stream is not ready", async () => {
    // Default mock already returns { client: null, isReady: false }
    // Just verify no errors when submitting

    mockFetchChatStream.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "content", content: "OK" })}\n\ndata: ${JSON.stringify({ type: "done" })}\n\n`),
          );
          controller.close();
        },
      }),
    });

    function NoStreamHarness() {
      const ctx = useChatContext();
      return (
        <div>
          <div data-testid="loading">{String(ctx.isLoading)}</div>
          <div data-testid="message-count">{ctx.messages.length}</div>
          <input
            data-testid="chat-input"
            value={ctx.input}
            onChange={(e) => ctx.setInput(e.target.value)}
          />
          <form onSubmit={ctx.handleSubmit}>
            <button type="submit" data-testid="submit">Send</button>
          </form>
          <button
            data-testid="register-handler"
            onClick={() => ctx.registerToolHandler({ executeToolCall: () => "result" })}
          />
        </div>
      );
    }

    render(
      <ChatProvider>
        <NoStreamHarness />
      </ChatProvider>,
    );

    await act(async () => {
      screen.getByTestId("register-handler").click();
    });

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "test" } });
    fireEvent.submit(screen.getByTestId("submit").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // Should complete without errors, using in-memory messages
    expect(screen.getByTestId("message-count").textContent).toBe("2");
  });
});
