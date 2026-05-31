import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CompiledSqlPanel } from "./CompiledSqlPanel";

// MR-5 — CompiledSqlPanel: collapsible compiled-SQL section with ref() wiring.
describe("CompiledSqlPanel", () => {
  it("renders the section collapsed by default with a toggle", () => {
    render(<CompiledSqlPanel sql="SELECT * FROM ref('stg_orders')" />);
    expect(screen.getByTestId("compiled-sql")).toBeInTheDocument();
    expect(screen.getByTestId("compiled-sql-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("compiled-sql-content")).not.toBeInTheDocument();
  });

  it("reveals the compiled SQL text on toggle", () => {
    render(<CompiledSqlPanel sql="SELECT * FROM ref('stg_orders')" />);
    fireEvent.click(screen.getByTestId("compiled-sql-toggle"));
    const content = screen.getByTestId("compiled-sql-content");
    expect(content).toBeInTheDocument();
    expect(content.textContent).toContain("ref('stg_orders')");
  });

  it("renders an empty-state when no compiled SQL is available", () => {
    render(<CompiledSqlPanel sql={null} />);
    expect(screen.getByTestId("compiled-sql")).toBeInTheDocument();
    expect(screen.getByTestId("compiled-sql-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("compiled-sql-toggle")).not.toBeInTheDocument();
  });
});
