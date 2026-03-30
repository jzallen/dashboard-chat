import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MessageBubble } from "../MessageBubble";

// --- Mocks ---

const mockAddMessage = vi.fn();
vi.mock("../../../../ui/context/ChatContext", () => ({
  useChatContext: () => ({
    handleDatasetSelected: vi.fn(),
    addMessage: mockAddMessage,
  }),
}));

vi.mock("../DatasetPicker", () => ({
  DatasetPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <div data-testid="dataset-picker-mock" onClick={() => onSelect("ds-1")} />
  ),
}));

vi.mock("../ProjectPicker", () => ({
  ProjectPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <div data-testid="project-picker-mock" onClick={() => onSelect("proj-1")} />
  ),
}));

vi.mock("../UploadWidget", () => ({
  UploadWidget: ({ projectId }: { projectId: string }) => (
    <div data-testid="upload-widget-mock">{projectId}</div>
  ),
}));

// --- Tests ---

describe("MessageBubble", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders message content", () => {
    const message = { id: "1", role: "user" as const, content: "Hello" };
    render(<MessageBubble message={message} isStreaming={false} />);
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders DatasetPicker for 'dataset-picker' widget", () => {
    const message = {
      id: "1",
      role: "assistant" as const,
      content: "Pick a dataset",
      widget: { type: "dataset-picker" as const },
    };
    render(<MessageBubble message={message} isStreaming={false} />);
    expect(screen.getByTestId("dataset-picker-mock")).toBeInTheDocument();
  });

  it("renders ProjectPicker for 'upload' widget", () => {
    const message = {
      id: "1",
      role: "assistant" as const,
      content: "Which project to upload to?",
      widget: { type: "upload" as const },
    };
    render(<MessageBubble message={message} isStreaming={false} />);
    expect(screen.getByTestId("project-picker-mock")).toBeInTheDocument();
  });

  it("adds file-upload message when project selected from upload widget", () => {
    const message = {
      id: "1",
      role: "assistant" as const,
      content: "Which project to upload to?",
      widget: { type: "upload" as const },
    };
    render(<MessageBubble message={message} isStreaming={false} />);
    fireEvent.click(screen.getByTestId("project-picker-mock"));
    expect(mockAddMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "Upload your file below.",
        widget: { type: "file-upload", projectId: "proj-1" },
      }),
    );
  });
});
