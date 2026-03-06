import { fireEvent,render, screen } from "@testing-library/react";
import { type Mock,vi } from "vitest";

import type { Dataset } from "@/dataCatalog";

import { ChatProvider, useChatContext } from "../../../ui/context/ChatContext";

function TestConsumer() {
  const { isActive, input, setInput, handleSubmit, registerToolHandler } = useChatContext();
  return (
    <div>
      <span data-testid="active">{String(isActive)}</span>
      <input
        data-testid="input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <button
        data-testid="submit"
        onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
        disabled={!isActive}
      >
        Send
      </button>
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

function MessageConsumer() {
  const { messages, addMessage } = useChatContext();
  return (
    <div>
      <span data-testid="message-count">{messages.length}</span>
      {messages.map((m) => (
        <span key={m.id} data-testid={`msg-${m.id}`}>{m.content}</span>
      ))}
      <button
        data-testid="add-message"
        onClick={() =>
          addMessage({ id: "test-1", role: "assistant", content: "Hello from addMessage" })
        }
      >
        Add
      </button>
      <button
        data-testid="add-widget-message"
        onClick={() =>
          addMessage({
            id: "upload-1",
            role: "assistant",
            content: "Upload a file:",
            widget: { type: "upload" },
          })
        }
      >
        Add Widget
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

describe("ChatContext", () => {
  it("renders children", () => {
    render(
      <ChatProvider>
        <div>child content</div>
      </ChatProvider>
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("isActive is false when no handler registered", () => {
    render(
      <ChatProvider>
        <TestConsumer />
      </ChatProvider>
    );
    expect(screen.getByTestId("active").textContent).toBe("false");
  });

  it("isActive is true after registerToolHandler called", () => {
    render(
      <ChatProvider>
        <TestConsumer />
      </ChatProvider>
    );
    fireEvent.click(screen.getByTestId("register"));
    expect(screen.getByTestId("active").textContent).toBe("true");
  });

  it("submit button is disabled when isActive is false", () => {
    render(
      <ChatProvider>
        <TestConsumer />
      </ChatProvider>
    );
    expect(screen.getByTestId("submit")).toBeDisabled();
  });

  it("registerToolHandler(null) reverts to inactive", () => {
    render(
      <ChatProvider>
        <TestConsumer />
      </ChatProvider>
    );
    fireEvent.click(screen.getByTestId("register"));
    expect(screen.getByTestId("active").textContent).toBe("true");
    fireEvent.click(screen.getByTestId("unregister"));
    expect(screen.getByTestId("active").textContent).toBe("false");
  });

  it("addMessage inserts a message into the list", () => {
    render(
      <ChatProvider>
        <MessageConsumer />
      </ChatProvider>
    );
    expect(screen.getByTestId("message-count").textContent).toBe("0");
    fireEvent.click(screen.getByTestId("add-message"));
    expect(screen.getByTestId("message-count").textContent).toBe("1");
    expect(screen.getByTestId("msg-test-1").textContent).toBe("Hello from addMessage");
  });

  it("addMessage supports widget messages", () => {
    render(
      <ChatProvider>
        <MessageConsumer />
      </ChatProvider>
    );
    fireEvent.click(screen.getByTestId("add-widget-message"));
    expect(screen.getByTestId("message-count").textContent).toBe("1");
    expect(screen.getByTestId("msg-upload-1").textContent).toBe("Upload a file:");
  });

  it("onDatasetCreated invokes the registered project updater", () => {
    const mockUpdater = vi.fn();
    render(
      <ChatProvider>
        <ProjectUpdaterConsumer onUpdated={mockUpdater} />
      </ChatProvider>
    );
    fireEvent.click(screen.getByTestId("register-updater"));
    fireEvent.click(screen.getByTestId("create-dataset"));
    expect(mockUpdater).toHaveBeenCalledOnce();
    expect(mockUpdater).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d-new", name: "New Dataset" })
    );
  });

  it("onDatasetCreated does nothing when no updater registered", () => {
    render(
      <ChatProvider>
        <ProjectUpdaterConsumer onUpdated={vi.fn()} />
      </ChatProvider>
    );
    fireEvent.click(screen.getByTestId("create-dataset"));
  });
});
