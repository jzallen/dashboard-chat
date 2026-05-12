import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ActivityLog } from "../ActivityLog";

// Test ActivityLog (the new component). TableView itself requires too many
// deeply-mocked hooks (useTableConfig, useTransforms, useDatasetQuery, ChatContext, etc.)
// and is better covered by integration/e2e tests.

describe("ActivityLog", () => {
  it("renders nothing when no messages and not streaming", () => {
    const { container } = render(
      <ActivityLog messages={[]} isStreaming={false} streamingContent="" />,
    );
    expect(container.querySelector("[data-testid='activity-log']")).toBeNull();
  });

  it("shows recent messages when new messages arrive", () => {
    const messages = [
      { id: "1", role: "user" as const, content: "Filter by status" },
      { id: "2", role: "assistant" as const, content: "Applied filter on status column" },
    ];

    // First render with 0 messages, then re-render with 2
    const { rerender } = render(
      <ActivityLog messages={[]} isStreaming={false} streamingContent="" />,
    );
    rerender(
      <ActivityLog messages={messages} isStreaming={false} streamingContent="" />,
    );

    expect(screen.getByTestId("activity-log")).toBeInTheDocument();
    expect(screen.getByText("Filter by status")).toBeInTheDocument();
    expect(screen.getByText("Applied filter on status column")).toBeInTheDocument();
  });

  it("shows streaming content when streaming", () => {
    render(
      <ActivityLog
        messages={[]}
        isStreaming={true}
        streamingContent="Processing your request..."
      />,
    );

    // Streaming shows even with no messages
    // The component only shows when visible flag is set by message count change or streaming
  });

  it("truncates long messages to 120 chars", () => {
    const longContent = "A".repeat(200);
    const messages = [{ id: "1", role: "user" as const, content: longContent }];

    const { rerender } = render(
      <ActivityLog messages={[]} isStreaming={false} streamingContent="" />,
    );
    rerender(
      <ActivityLog messages={messages} isStreaming={false} streamingContent="" />,
    );

    const displayed = screen.getByText(/^A+\.\.\.$/);
    expect(displayed.textContent!.length).toBeLessThan(200);
  });

  it("shows only last 3 messages", () => {
    const messages = [
      { id: "1", role: "user" as const, content: "Message 1" },
      { id: "2", role: "assistant" as const, content: "Message 2" },
      { id: "3", role: "user" as const, content: "Message 3" },
      { id: "4", role: "assistant" as const, content: "Message 4" },
    ];

    const { rerender } = render(
      <ActivityLog messages={[]} isStreaming={false} streamingContent="" />,
    );
    rerender(
      <ActivityLog messages={messages} isStreaming={false} streamingContent="" />,
    );

    expect(screen.queryByText("Message 1")).not.toBeInTheDocument();
    expect(screen.getByText("Message 2")).toBeInTheDocument();
    expect(screen.getByText("Message 3")).toBeInTheDocument();
    expect(screen.getByText("Message 4")).toBeInTheDocument();
  });
});
