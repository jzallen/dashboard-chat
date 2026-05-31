import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DataPreviewGrid } from "./DataPreviewGrid";

// MR-5 — DataPreviewGrid: sample-rows grid, or a documented "not available"
// empty-state for layers whose preview is not served by the API today.
describe("DataPreviewGrid", () => {
  it("renders the documented empty-state when preview is unavailable", () => {
    render(<DataPreviewGrid available={false} />);
    expect(screen.getByTestId("data-preview")).toBeInTheDocument();
    expect(screen.getByTestId("data-preview-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("data-preview-grid")).not.toBeInTheDocument();
  });

  it("renders a grid of sample rows when preview is available", () => {
    render(
      <DataPreviewGrid
        available
        columns={["month", "amount"]}
        rows={[
          { month: "Jan", amount: 100 },
          { month: "Feb", amount: 200 },
        ]}
      />,
    );
    const grid = screen.getByTestId("data-preview-grid");
    expect(within(grid).getByText("month")).toBeInTheDocument();
    expect(within(grid).getByText("amount")).toBeInTheDocument();
    expect(within(grid).getByText("Jan")).toBeInTheDocument();
    expect(within(grid).getByText("200")).toBeInTheDocument();
  });

  it("renders an empty-rows state when available but no rows", () => {
    render(<DataPreviewGrid available columns={["month"]} rows={[]} />);
    expect(screen.getByTestId("data-preview-empty")).toBeInTheDocument();
  });

  it("caps rendered rows at maxRows", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ n: i }));
    render(<DataPreviewGrid available columns={["n"]} rows={rows} maxRows={3} />);
    const grid = screen.getByTestId("data-preview-grid");
    // 3 body rows + 1 header row
    expect(within(grid).getAllByRole("row")).toHaveLength(4);
  });
});
