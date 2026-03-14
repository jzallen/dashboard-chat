import { fireEvent,render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Transform } from "@/dataCatalog";

// Mock TransformCard to avoid deep dependency tree (countRules, css modules, etc.)
vi.mock("../TransformSettings/TransformList/TransformCard/index", () => ({
  TransformCard: ({ transform }: { transform: Transform }) => (
    <div data-testid={`transform-${transform.id}`}>{transform.name}</div>
  ),
}));

import { TransformList } from "../TransformSettings/TransformList/index";

function makeTransform(overrides: Partial<Transform> = {}): Transform {
  return {
    id: "t-1",
    name: "Test Transform",
    description: null,
    condition_json: null,
    condition_sql: null,
    status: "enabled",
    transform_type: "filter",
    target_column: null,
    expression_config: null,
    expression_sql: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultProps = {
  transforms: [] as Transform[],
  loading: false,
  error: null,
  onToggle: vi.fn(),
  onDelete: vi.fn(),
  onRefresh: vi.fn(),
};

describe("TransformList", () => {
  it("shows loading state when loading with no transforms", () => {
    render(<TransformList {...defaultProps} loading={true} />);
    expect(screen.getByText("Loading saved transforms...")).toBeInTheDocument();
  });

  it("shows empty state when no transforms", () => {
    render(<TransformList {...defaultProps} />);
    expect(screen.getByText("No saved transforms yet.")).toBeInTheDocument();
  });

  it("shows error state with retry button", () => {
    const onRefresh = vi.fn();
    render(
      <TransformList {...defaultProps} error="Network error" onRefresh={onRefresh} />,
    );
    expect(screen.getByText("Network error")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Try again"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("renders active transforms section", () => {
    const transforms = [
      makeTransform({ id: "t-1", name: "Filter A", status: "enabled" }),
      makeTransform({ id: "t-2", name: "Filter B", status: "enabled" }),
    ];
    render(<TransformList {...defaultProps} transforms={transforms} />);

    expect(screen.getByText(/Active Transforms \(2\)/)).toBeInTheDocument();
    expect(screen.getByText("Filter A")).toBeInTheDocument();
    expect(screen.getByText("Filter B")).toBeInTheDocument();
  });

  it("separates active and inactive transforms", () => {
    const transforms = [
      makeTransform({ id: "t-1", name: "Active One", status: "enabled" }),
      makeTransform({ id: "t-2", name: "Disabled One", status: "disabled" }),
      makeTransform({ id: "t-3", name: "Deleted One", status: "deleted" }),
    ];
    render(<TransformList {...defaultProps} transforms={transforms} />);

    expect(screen.getByText(/Active Transforms \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Inactive Transforms \(2\)/)).toBeInTheDocument();
    expect(screen.getByText("Active One")).toBeInTheDocument();
    expect(screen.getByText("Disabled One")).toBeInTheDocument();
    expect(screen.getByText("Deleted One")).toBeInTheDocument();
  });

  it("does not show loading state when loading with existing transforms", () => {
    const transforms = [makeTransform()];
    render(<TransformList {...defaultProps} transforms={transforms} loading={true} />);
    expect(screen.queryByText("Loading saved transforms...")).not.toBeInTheDocument();
  });
});
