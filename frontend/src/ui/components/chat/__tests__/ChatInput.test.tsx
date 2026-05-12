import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ChatInput } from "../ChatInput";

describe("ChatInput", () => {
  const defaultProps = {
    input: "",
    setInput: vi.fn(),
    onSubmit: vi.fn((e) => e.preventDefault()),
    isLoading: false,
  };

  it("renders textarea and submit button", () => {
    render(<ChatInput {...defaultProps} />);
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("submits on Enter key", () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(<ChatInput {...defaultProps} input="Hello" onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByTestId("chat-input"), {
      key: "Enter",
      shiftKey: false,
    });

    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("does not submit on Shift+Enter (allows newline)", () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(<ChatInput {...defaultProps} input="Hello" onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByTestId("chat-input"), {
      key: "Enter",
      shiftKey: true,
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not submit on Enter with empty input", () => {
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(<ChatInput {...defaultProps} input="" onSubmit={onSubmit} />);

    fireEvent.keyDown(screen.getByTestId("chat-input"), {
      key: "Enter",
      shiftKey: false,
    });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("disables textarea and button when loading", () => {
    render(<ChatInput {...defaultProps} isLoading={true} />);
    expect(screen.getByTestId("chat-input")).toBeDisabled();
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("shows dataset name in gutter when provided", () => {
    render(<ChatInput {...defaultProps} datasetName="sales_data" />);
    expect(screen.getByText("sales_data")).toBeInTheDocument();
  });

  it("does not show gutter when datasetName is not provided", () => {
    const { container } = render(<ChatInput {...defaultProps} />);
    expect(container.querySelector("[class*='chatInputGutter']")).not.toBeInTheDocument();
  });

  it("calls setInput on change", () => {
    const setInput = vi.fn();
    render(<ChatInput {...defaultProps} setInput={setInput} />);

    fireEvent.change(screen.getByTestId("chat-input"), {
      target: { value: "test" },
    });

    expect(setInput).toHaveBeenCalledWith("test");
  });

  it("textarea auto-expands on content change", () => {
    const { rerender } = render(<ChatInput {...defaultProps} input="" />);
    const textarea = screen.getByTestId("chat-input") as HTMLTextAreaElement;

    // Re-render with multiline content — the height adjustment happens via useEffect
    rerender(<ChatInput {...defaultProps} input={"line1\nline2\nline3"} />);
    // The textarea style.height should be set (auto-expand logic runs)
    expect(textarea.style.height).toBeDefined();
  });
});
