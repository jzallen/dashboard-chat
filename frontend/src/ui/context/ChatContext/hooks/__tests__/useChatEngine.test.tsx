import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ToolHandler } from "../useChatEngine";
import { ChatProvider, useChatContext } from "../useChatEngine";
import type { Dataset } from "@/dataCatalog";

// --- Mocks (same pattern as ChatContext.test.tsx) ---

vi.mock("@/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/chat")>();
  return {
    ...actual,
    createChatClient: () => ({
      createSession: vi.fn().mockResolvedValue({ id: "sess-001" }),
      logTurn: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn(),
      listSessions: vi.fn(),
      fetchChatStream: vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.close();
          },
        }),
      }),
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
});
