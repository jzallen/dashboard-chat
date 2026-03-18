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
vi.mock("@/stream/StreamProvider", () => ({
  useStreamContext: (...args: unknown[]) => mockUseStreamContext(...args),
}));

const mockEntityContext = {
  projectId: null as string | null,
  entityType: null as string | null,
  entityId: null as string | null,
  tableSchema: null,
  setProjectId: vi.fn(),
  setEntityType: vi.fn(),
  setEntityId: vi.fn(),
  setTableSchema: vi.fn(),
};
const mockUseEntityContext = vi.fn(() => mockEntityContext);
vi.mock("@/stream/useEntityContext", () => ({
  useEntityContext: (...args: unknown[]) => mockUseEntityContext(...args),
}));

// --- Test harness ---

function TestHarness() {
  const ctx = useChatContext();

  return (
    <div>
      <div data-testid="message-count">{ctx.messages.length}</div>
      <div data-testid="has-channel">{String(ctx.channel !== null)}</div>
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
    mockEntityContext.entityId = null;
    mockEntityContext.entityType = null;
    mockEntityContext.projectId = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts with no channel and no messages", () => {
    renderEngine();

    expect(screen.getByTestId("has-channel").textContent).toBe("false");
    expect(screen.getByTestId("message-count").textContent).toBe("0");
  });

  it("addMessage appends to message list", async () => {
    renderEngine();

    await act(async () => {
      screen.getByTestId("add-message").click();
    });

    expect(screen.getByTestId("message-count").textContent).toBe("1");
    expect(screen.getByTestId("msg-custom-1").textContent).toBe("Added message");
  });

  it("resetSession clears all messages and channel", async () => {
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
    expect(screen.getByTestId("has-channel").textContent).toBe("false");
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
    mockUseStreamContext.mockReturnValue({ client: null, isReady: false });
    mockFetchChatStream.mockReset().mockResolvedValue({
      ok: true,
      body: new ReadableStream({ start(c) { c.close(); } }),
    });
  });

  it("createChannel creates a channel with correct ID format and custom data", async () => {
    const mockWatch = vi.fn().mockResolvedValue(undefined);
    const mockChannel = {
      id: "chat_abc123_deadbeef",
      data: { orgId: "org-1" },
      watch: mockWatch,
      state: { messages: [] },
      on: vi.fn(),
      off: vi.fn(),
    };
    const mockStreamClient = {
      userID: "user-1",
      channel: vi.fn().mockReturnValue(mockChannel),
    };

    mockUseStreamContext.mockReturnValue({ client: mockStreamClient, isReady: true });

    let capturedCtx: ReturnType<typeof useChatContext>;

    function ChannelHarness() {
      capturedCtx = useChatContext();
      return (
        <div>
          <div data-testid="has-channel">{String(capturedCtx.channel !== null)}</div>
          <div data-testid="channel-id">{capturedCtx.channel?.id ?? ""}</div>
        </div>
      );
    }

    render(
      <ChatProvider>
        <ChannelHarness />
      </ChatProvider>,
    );

    await act(async () => {
      await capturedCtx!.createChannel("org-1");
    });

    // Verify channel() was called with "messaging" type and a session ID matching expected format
    expect(mockStreamClient.channel).toHaveBeenCalledWith(
      "messaging",
      expect.stringMatching(/^chat_[a-z0-9]+_[a-f0-9]{8}$/),
      expect.objectContaining({
        orgId: "org-1",
        projectId: null,
        datasetId: null,
        title: null,
      }),
    );
    expect(mockWatch).toHaveBeenCalled();
    expect(screen.getByTestId("has-channel").textContent).toBe("true");
  });

  it("loadChannel watches channel, sets it as current, and restores dataset context", async () => {
    const mockWatch = vi.fn().mockResolvedValue(undefined);
    const mockChannel = {
      id: "existing-channel",
      data: { datasetId: "ds-restored" },
      watch: mockWatch,
      state: {
        messages: [
          { id: "m1", text: "hello", user: { id: "user-1" } },
          { id: "m2", text: "world", user: { id: "assistant" } },
        ],
      },
      on: vi.fn(),
      off: vi.fn(),
    };
    const mockStreamClient = {
      userID: "user-1",
      channel: vi.fn().mockReturnValue(mockChannel),
    };

    mockUseStreamContext.mockReturnValue({ client: mockStreamClient, isReady: true });

    let capturedCtx: ReturnType<typeof useChatContext>;

    function LoadHarness() {
      capturedCtx = useChatContext();
      return (
        <div>
          <div data-testid="has-channel">{String(capturedCtx.channel !== null)}</div>
          <div data-testid="message-count">{capturedCtx.messages.length}</div>
          {capturedCtx.messages.map((m) => (
            <div key={m.id} data-testid={`msg-${m.id}`}>
              {m.role}:{m.content}
            </div>
          ))}
        </div>
      );
    }

    render(
      <ChatProvider>
        <LoadHarness />
      </ChatProvider>,
    );

    await act(async () => {
      await capturedCtx!.loadChannel("existing-channel");
    });

    expect(mockStreamClient.channel).toHaveBeenCalledWith("messaging", "existing-channel");
    expect(mockWatch).toHaveBeenCalled();
    expect(screen.getByTestId("has-channel").textContent).toBe("true");

    // Verify messages were loaded from channel history
    expect(screen.getByTestId("message-count").textContent).toBe("2");
    expect(screen.getByTestId("msg-m1").textContent).toBe("user:hello");
    expect(screen.getByTestId("msg-m2").textContent).toBe("assistant:world");

    // Verify dataset context was restored
    expect(mockEntityContext.setEntityId).toHaveBeenCalledWith("ds-restored");
    expect(mockEntityContext.setEntityType).toHaveBeenCalledWith("dataset");
  });

  it("writeToStream is a no-op when Stream is not ready", async () => {
    // Default mock already returns { client: null, isReady: false }

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
        </div>
      );
    }

    render(
      <ChatProvider>
        <NoStreamHarness />
      </ChatProvider>,
    );

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "test" } });
    fireEvent.submit(screen.getByTestId("submit").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // Should complete without errors, using in-memory messages
    expect(screen.getByTestId("message-count").textContent).toBe("2");
  });
});

// ---------------------------------------------------------------------------
// Session title auto-set, dataset picker, and re-submit
// ---------------------------------------------------------------------------

describe("useChatEngine — session title, dataset picker, and re-submit", () => {
  beforeEach(() => {
    mockUseStreamContext.mockReturnValue({ client: null, isReady: false });
    mockFetchChatStream.mockReset().mockResolvedValue({
      ok: true,
      body: new ReadableStream({ start(c) { c.close(); } }),
    });
    mockEntityContext.entityId = null;
    mockEntityContext.setEntityId.mockClear();
    mockEntityContext.setEntityType.mockClear();
  });

  it("auto-sets channel title from the first submitted message text", async () => {
    const mockUpdatePartial = vi.fn().mockResolvedValue(undefined);
    const mockSendMessage = vi.fn().mockResolvedValue(undefined);
    const mockChannel = {
      id: "test-channel",
      data: { orgId: "org-1" },
      watch: vi.fn().mockResolvedValue(undefined),
      state: { messages: [] },
      on: vi.fn(),
      off: vi.fn(),
      updatePartial: mockUpdatePartial,
      sendMessage: mockSendMessage,
    };
    const mockStreamClient = {
      userID: "user-1",
      channel: vi.fn().mockReturnValue(mockChannel),
    };

    mockUseStreamContext.mockReturnValue({ client: mockStreamClient, isReady: true });

    let capturedCtx: ReturnType<typeof useChatContext>;

    function TitleHarness() {
      capturedCtx = useChatContext();
      return (
        <div>
          <input
            data-testid="chat-input"
            value={capturedCtx.input}
            onChange={(e) => capturedCtx.setInput(e.target.value)}
          />
          <form onSubmit={capturedCtx.handleSubmit}>
            <button type="submit" data-testid="submit">Send</button>
          </form>
        </div>
      );
    }

    render(
      <ChatProvider>
        <TitleHarness />
      </ChatProvider>,
    );

    // Create a channel so channelRef is set
    await act(async () => {
      await capturedCtx!.createChannel("org-1");
    });

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "Hello world" } });
    fireEvent.submit(screen.getByTestId("submit").closest("form")!);

    await waitFor(() => {
      expect(mockUpdatePartial).toHaveBeenCalledWith({ set: { title: "Hello world" } });
    });
  });

  it("appends dataset-picker widget when table-op keyword sent without a dataset context", async () => {
    function PickerHarness() {
      const ctx = useChatContext();
      return (
        <div>
          <div data-testid="loading">{String(ctx.isLoading)}</div>
          <div data-testid="message-count">{ctx.messages.length}</div>
          {ctx.messages.map((m) => (
            <div key={m.id} data-testid={`msg-${m.id}`} data-widget={m.widget?.type ?? ""}>
              {m.content}
            </div>
          ))}
          <input
            data-testid="chat-input"
            value={ctx.input}
            onChange={(e) => ctx.setInput(e.target.value)}
          />
          <form onSubmit={ctx.handleSubmit}>
            <button type="submit" data-testid="submit">Send</button>
          </form>
        </div>
      );
    }

    render(
      <ChatProvider>
        <PickerHarness />
      </ChatProvider>,
    );

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "filter by status" } });
    fireEvent.submit(screen.getByTestId("submit").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // User message + assistant picker widget
    expect(screen.getByTestId("message-count").textContent).toBe("2");
    const msgs = screen.getAllByTestId(/^msg-/);
    const pickerMsg = msgs[msgs.length - 1];
    expect(pickerMsg.getAttribute("data-widget")).toBe("dataset-picker");
    expect(pickerMsg.textContent).toContain("select a dataset");
    // API should NOT have been called (picker intercepts the request)
    expect(mockFetchChatStream).not.toHaveBeenCalled();
  });

  it("re-submits the pending command after dataset is selected from picker", async () => {
    mockFetchChatStream.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "content", content: "Done!" })}\n\n` +
              `data: ${JSON.stringify({ type: "done" })}\n\n`,
            ),
          );
          controller.close();
        },
      }),
    });

    function ResubmitHarness() {
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
            data-testid="select-dataset"
            onClick={() => ctx.handleDatasetSelected("ds-picked")}
          />
        </div>
      );
    }

    render(
      <ChatProvider>
        <ResubmitHarness />
      </ChatProvider>,
    );

    // Submit a table-op message — triggers picker, no API call
    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "sort by name" } });
    fireEvent.submit(screen.getByTestId("submit").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });
    expect(screen.getByTestId("message-count").textContent).toBe("2");
    expect(mockFetchChatStream).not.toHaveBeenCalled();

    // Simulate entity context update (what registerDatasetId would normally do)
    mockEntityContext.entityId = "ds-picked";

    // Select a dataset — should re-submit the pending command
    await act(async () => {
      screen.getByTestId("select-dataset").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // fetchChatStream should have been called for the re-submitted command
    expect(mockFetchChatStream).toHaveBeenCalledOnce();
    // More messages should have been added (user re-submit + assistant response)
    expect(Number(screen.getByTestId("message-count").textContent)).toBeGreaterThan(2);
  });
});

// ---------------------------------------------------------------------------
// Navigate-to-table prompt when tool calls arrive without a handler
// ---------------------------------------------------------------------------

describe("useChatEngine — navigate-to-table prompt", () => {
  beforeEach(() => {
    mockUseStreamContext.mockReturnValue({ client: null, isReady: false });
    mockFetchChatStream.mockReset();
    mockEntityContext.entityId = null;
    mockEntityContext.setEntityId.mockClear();
    mockEntityContext.setEntityType.mockClear();
  });

  it("appends navigation prompt when tool calls returned but no handler registered", async () => {
    // Use a message without table-op keywords to bypass dataset picker detection
    // but the worker still returns tool_calls in the response
    const toolCalls = [{ id: "tc1", function: { name: "filter_rows", arguments: '{"col":"a"}' } }];

    mockFetchChatStream.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "tool_calls", tool_calls: toolCalls })}\n\n` +
              `data: ${JSON.stringify({ type: "done" })}\n\n`,
            ),
          );
          controller.close();
        },
      }),
    });

    function NavPromptHarness() {
      const ctx = useChatContext();
      return (
        <div>
          <div data-testid="loading">{String(ctx.isLoading)}</div>
          <div data-testid="message-count">{ctx.messages.length}</div>
          {ctx.messages.map((m) => (
            <div key={m.id} data-testid={`msg-${m.id}`}>
              {m.content}
            </div>
          ))}
          <input
            data-testid="chat-input"
            value={ctx.input}
            onChange={(e) => ctx.setInput(e.target.value)}
          />
          <form onSubmit={ctx.handleSubmit}>
            <button type="submit" data-testid="submit">Send</button>
          </form>
        </div>
      );
    }

    render(
      <ChatProvider>
        <NavPromptHarness />
      </ChatProvider>,
    );

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "apply transformation" } });
    fireEvent.submit(screen.getByTestId("submit").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    // Should have user + assistant messages
    expect(screen.getByTestId("message-count").textContent).toBe("2");

    // The assistant message should contain the "Select a dataset" prompt (no entityId set)
    const assistantMessages = screen.getAllByTestId(/^msg-/);
    const lastMsg = assistantMessages[assistantMessages.length - 1];
    expect(lastMsg.textContent).toContain("Select a dataset first");
  });

  it("includes dataset link in navigation prompt when entityId is set", async () => {
    // Set entityId so the nav message includes a link
    mockEntityContext.entityId = "ds-42";

    const toolCalls = [{ id: "tc1", function: { name: "sort_rows", arguments: '{}' } }];

    mockFetchChatStream.mockResolvedValue({
      ok: true,
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "tool_calls", tool_calls: toolCalls })}\n\n` +
              `data: ${JSON.stringify({ type: "done" })}\n\n`,
            ),
          );
          controller.close();
        },
      }),
    });

    function NavWithDatasetHarness() {
      const ctx = useChatContext();
      return (
        <div>
          <div data-testid="loading">{String(ctx.isLoading)}</div>
          <div data-testid="message-count">{ctx.messages.length}</div>
          {ctx.messages.map((m) => (
            <div key={m.id} data-testid={`msg-${m.id}`}>
              {m.content}
            </div>
          ))}
          <input
            data-testid="chat-input"
            value={ctx.input}
            onChange={(e) => ctx.setInput(e.target.value)}
          />
          <form onSubmit={ctx.handleSubmit}>
            <button type="submit" data-testid="submit">Send</button>
          </form>
        </div>
      );
    }

    render(
      <ChatProvider>
        <NavWithDatasetHarness />
      </ChatProvider>,
    );

    fireEvent.change(screen.getByTestId("chat-input"), { target: { value: "sort it" } });
    fireEvent.submit(screen.getByTestId("submit").closest("form")!);

    await waitFor(() => {
      expect(screen.getByTestId("loading").textContent).toBe("false");
    });

    const assistantMessages = screen.getAllByTestId(/^msg-/);
    const lastMsg = assistantMessages[assistantMessages.length - 1];
    expect(lastMsg.textContent).toContain("Navigate to the table view");
    expect(lastMsg.textContent).toContain("/table/ds-42");
  });
});
