import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { FilterBadge } from "../TablePanel/ActiveFilters/FilterBadge";

describe("FilterBadge", () => {
  it("renders a single condition filter", () => {
    const filter = {
      id: "age",
      value: { operator: ">=", value: 18 },
    };
    render(<FilterBadge filter={filter} onRemove={vi.fn()} />);

    expect(screen.getByText(/age/)).toBeInTheDocument();
    expect(screen.getByText(/>=\s*18/)).toBeInTheDocument();
  });

  it("renders compound conditions joined by AND", () => {
    const filter = {
      id: "price",
      value: {
        conditions: [
          { operator: ">", value: 10 },
          { operator: "<", value: 100 },
        ],
      },
    };
    render(<FilterBadge filter={filter} onRemove={vi.fn()} />);

    expect(screen.getByText(/> 10 AND < 100/)).toBeInTheDocument();
  });

  it("calls onRemove when remove button is clicked", () => {
    const onRemove = vi.fn();
    const filter = {
      id: "status",
      value: { operator: "=", value: "active" },
    };
    render(<FilterBadge filter={filter} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "Remove filter" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
