import { render, screen, fireEvent } from "@testing-library/react";
import { ChatProvider, useChatContext } from "../../../lib/ui/context/ChatContext";

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
});
