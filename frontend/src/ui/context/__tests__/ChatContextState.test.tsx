import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, type Mock, vi } from "vitest";

import type { Dataset } from "@/dataCatalog";

vi.mock("@/auth", () => ({
  withAuth: (f: typeof fetch) => f,
  withEagerAuth: (f: typeof fetch) => f,
}));

vi.mock("@/chat", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/chat")>();
  return {
    ...actual,
    createChatClient: () => ({
      fetchChatStream: vi.fn().mockResolvedValue({
        ok: true,
        body: new ReadableStream({ start(c) { c.close(); } }),
      }),
    }),
  };
});

vi.mock("@/chat/prompts", () => ({
  getSystemPrompt: () => "system prompt",
  getToolDefinitions: () => [],
}));

vi.mock("@/stream/StreamProvider", () => ({
  useStreamContext: () => ({ client: null, isReady: false }),
}));

vi.mock("@/stream/useEntityContext", () => ({
  useEntityContext: () => ({
    projectId: null,
    entityType: null,
    entityId: null,
    tableSchema: null,
    setProjectId: vi.fn(),
    setEntityType: vi.fn(),
    setEntityId: vi.fn(),
    setTableSchema: vi.fn(),
    setContext: vi.fn(),
  }),
}));

vi.mock("@/stream/useSSEOverlay", () => ({
  useSSEOverlay: () => ({
    isStreaming: false,
    streamingContent: "",
    startStreaming: vi.fn(),
    stopStreaming: vi.fn(),
    updateContent: vi.fn(),
  }),
}));


import { ChatProvider, useChatContext } from "../ChatContext";

function TestConsumer() {
  const { channel, registerToolHandler } = useChatContext();
  return (
    <div>
      <span data-testid="has-channel">{String(channel !== null)}</span>
      <button
        data-testid="register"
        onClick={() =>
          registerToolHandler({ executeToolCall: () => "ok" })
        }
      >
        Register
      </button>
      <button
        data-testid="unregister"
        onClick={() => registerToolHandler(null)}
      >
        Unregister
      </button>
    </div>
  );
}

function ProjectUpdaterConsumer({ onUpdated }: { onUpdated: Mock }) {
  const { registerProjectUpdater, onDatasetCreated } = useChatContext();

  return (
    <div>
      <button
        data-testid="register-updater"
        onClick={() => registerProjectUpdater(onUpdated)}
      >
        Register Updater
      </button>
      <button
        data-testid="create-dataset"
        onClick={() =>
          onDatasetCreated({
            id: "d-new",
            name: "New Dataset",
          } as Dataset)
        }
      >
        Create Dataset
      </button>
    </div>
  );
}

describe("ChatContext state edge cases", () => {
  it("starts with no channel", () => {
    render(
      <ChatProvider>
        <TestConsumer />
      </ChatProvider>,
    );
    expect(screen.getByTestId("has-channel").textContent).toBe("false");
  });

  it("onDatasetCreated invokes the registered project updater", () => {
    const mockUpdater = vi.fn();
    render(
      <ChatProvider>
        <ProjectUpdaterConsumer onUpdated={mockUpdater} />
      </ChatProvider>,
    );
    fireEvent.click(screen.getByTestId("register-updater"));
    fireEvent.click(screen.getByTestId("create-dataset"));
    expect(mockUpdater).toHaveBeenCalledOnce();
    expect(mockUpdater).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d-new", name: "New Dataset" }),
    );
  });

  it("onDatasetCreated does nothing when no updater registered", () => {
    render(
      <ChatProvider>
        <ProjectUpdaterConsumer onUpdated={vi.fn()} />
      </ChatProvider>,
    );
    // Should not throw
    fireEvent.click(screen.getByTestId("create-dataset"));
  });
});
