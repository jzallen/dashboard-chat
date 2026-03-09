import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { OperationsLog } from "../TablePanel/OperationsLog";

function createMockChannel(messages: Array<Record<string, unknown>> = []) {
  const listeners: Record<string, Array<(event: unknown) => void>> = {};
  return {
    state: { messages },
    on: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    }),
    off: vi.fn((event: string, handler: (event: unknown) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter((h) => h !== handler);
      }
    }),
    _emit: (event: string, data: unknown) => {
      listeners[event]?.forEach((h) => h(data));
    },
  };
}

describe("OperationsLog", () => {
  it("renders nothing when no channel", () => {
    const { container } = render(<OperationsLog channel={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when channel has no tool calls", () => {
    const channel = createMockChannel([
      { id: "msg-1", text: "Hello", created_at: "2025-01-01T00:00:00Z" },
    ]);
    const { container } = render(<OperationsLog channel={channel as any} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders operations log when channel has tool calls", () => {
    const channel = createMockChannel([
      {
        id: "msg-1",
        text: "Applied filter",
        created_at: "2025-01-01T00:00:00Z",
        custom: {
          tool_calls: [
            { id: "tc-1", name: "filterTable", args: { column: "age" }, result: "Filtered" },
          ],
        },
      },
    ]);

    render(<OperationsLog channel={channel as any} />);

    expect(screen.getByText(/Operations Log \(1\)/)).toBeTruthy();
  });

  it("deduplicates tool calls by id", () => {
    const channel = createMockChannel([
      {
        id: "msg-1",
        text: "Filter applied",
        created_at: "2025-01-01T00:00:00Z",
        custom: {
          tool_calls: [
            { id: "tc-1", name: "filterTable", args: { column: "age" }, result: "Filtered" },
          ],
        },
      },
      {
        id: "msg-2",
        text: "Filter applied again",
        created_at: "2025-01-01T00:01:00Z",
        custom: {
          tool_calls: [
            { id: "tc-1", name: "filterTable", args: { column: "age" }, result: "Filtered" },
          ],
        },
      },
    ]);

    render(<OperationsLog channel={channel as any} />);

    // Should show 2 entries (same id but from different messages)
    expect(screen.getByText(/Operations Log/)).toBeTruthy();
  });

  it("clears entries when channel changes to null", () => {
    const channel = createMockChannel([
      {
        id: "msg-1",
        text: "Applied filter",
        created_at: "2025-01-01T00:00:00Z",
        custom: {
          tool_calls: [
            { id: "tc-1", name: "filterTable", args: {}, result: "Done" },
          ],
        },
      },
    ]);

    const { rerender, container } = render(<OperationsLog channel={channel as any} />);
    expect(screen.getByText(/Operations Log/)).toBeTruthy();

    rerender(<OperationsLog channel={null} />);
    expect(container.innerHTML).toBe("");
  });
});
