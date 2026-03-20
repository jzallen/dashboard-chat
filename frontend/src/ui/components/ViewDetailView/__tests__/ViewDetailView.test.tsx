import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent,render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach,describe, expect, it, vi } from "vitest";

import type { View } from "@/dataCatalog";

const mockView: View = {
  id: "view-1",
  project_id: "proj-1",
  org_id: "org-1",
  name: "Revenue Summary",
  description: "Monthly revenue aggregation",
  sql_definition: "SELECT s0.month FROM orders AS s0",
  display_sql: "-- SQL Preview — for reference only\nSELECT CAST(s0.\"month\" AS text) AS \"month\" FROM orders AS s0",
  source_refs: [
    { id: "ds-1", type: "dataset" },
    { id: "view-2", type: "view" },
  ],
  columns: [
    { name: "month", source_ref: "ds-1", source_column: "month", display_type: "text", grain_role: null, alias: null },
    { name: "amount", source_ref: "ds-1", source_column: "amount", display_type: "decimal", grain_role: "Metric", alias: null },
  ],
  joins: [],
  filters: [],
  grain: { time_column: "month", dimensions: [] },
  materialization: "view",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
};

// Mock hooks
const mockSetContext = vi.fn();
const mockRegisterToolHandler = vi.fn();

vi.mock("../../../context/ChatContext", () => ({
  useChatContext: () => ({
    messages: [],
    input: "",
    setInput: vi.fn(),
    isLoading: false,
    handleSubmit: vi.fn(),
    registerToolHandler: mockRegisterToolHandler,
    setContext: mockSetContext,
    channel: null,
    isStreaming: false,
    streamingContent: "",
  }),
}));

vi.mock("../../../hooks/useViewQuery", () => ({
  useViewQuery: (viewId: string | undefined) => ({
    data: viewId === "view-1" ? mockView : undefined,
    isLoading: false,
    isError: viewId !== "view-1",
  }),
}));

vi.mock("../../../hooks/queryKeys", () => ({
  viewKeys: {
    all: ["views"],
    lists: () => ["views", "list"],
    list: (projectId: string) => ["views", "list", projectId],
    details: () => ["views", "detail"],
    detail: (id: string) => ["views", "detail", id],
  },
}));

function renderWithRouter(viewId: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/view/${viewId}`]}>
        <Routes>
          <Route path="view/:viewId" element={<ViewDetailView />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// Import after mocks
import { ViewDetailView } from "..";

describe("ViewDetailView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders view name and materialization", () => {
    renderWithRouter("view-1");
    expect(screen.getByText("Revenue Summary")).toBeInTheDocument();
    expect(screen.getAllByText("view").length).toBeGreaterThanOrEqual(1);
  });

  it("renders description when present", () => {
    renderWithRouter("view-1");
    expect(screen.getByText("Monthly revenue aggregation")).toBeInTheDocument();
  });

  it("renders schema table with columns", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("view-schema-table")).toBeInTheDocument();
    expect(screen.getByText("month")).toBeInTheDocument();
    expect(screen.getByText("amount")).toBeInTheDocument();
  });

  it("renders grain role column when grain is defined", () => {
    renderWithRouter("view-1");
    expect(screen.getByText("Grain Role")).toBeInTheDocument();
    expect(screen.getByText("Metric")).toBeInTheDocument();
  });

  it("renders source dependency links with correct hrefs", () => {
    renderWithRouter("view-1");
    const list = screen.getByTestId("source-dependency-list");
    const links = list.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/table/ds-1");
    expect(links[1]).toHaveAttribute("href", "/view/view-2");
  });

  it("SQL preview panel is collapsed by default", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("sql-preview-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("sql-preview-content")).not.toBeInTheDocument();
  });

  it("SQL preview panel expands on click", () => {
    renderWithRouter("view-1");
    fireEvent.click(screen.getByTestId("sql-preview-toggle"));
    const content = screen.getByTestId("sql-preview-content");
    expect(content).toBeInTheDocument();
    expect(content.textContent).toContain("SQL Preview");
  });

  it("SQL preview panel collapses again on second click", () => {
    renderWithRouter("view-1");
    const toggle = screen.getByTestId("sql-preview-toggle");
    fireEvent.click(toggle);
    expect(screen.getByTestId("sql-preview-content")).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByTestId("sql-preview-content")).not.toBeInTheDocument();
  });

  it("shows error state for unknown view", () => {
    renderWithRouter("unknown-id");
    expect(screen.getByText("View not found")).toBeInTheDocument();
  });

  it("sets context on mount and clears on unmount", () => {
    const { unmount } = renderWithRouter("view-1");
    expect(mockSetContext).toHaveBeenCalledWith("view", "view-1");
    unmount();
    expect(mockSetContext).toHaveBeenCalledWith(null, null);
  });

  it("registers and unregisters tool handler", () => {
    const { unmount } = renderWithRouter("view-1");
    expect(mockRegisterToolHandler).toHaveBeenCalledWith(
      expect.objectContaining({ executeToolCall: expect.any(Function) }),
    );
    unmount();
    expect(mockRegisterToolHandler).toHaveBeenCalledWith(null);
  });

  it("renders chat input with view context label", () => {
    renderWithRouter("view-1");
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });
});
