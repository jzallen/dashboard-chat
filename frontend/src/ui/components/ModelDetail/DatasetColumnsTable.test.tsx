import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { SchemaConfig } from "@/dataCatalog";

import { DatasetColumnsTable } from "./DatasetColumnsTable";

// MR-5 — DatasetColumnsTable: dataset columns/measures table from schema_config.
const schema: SchemaConfig = {
  fields: {
    order_id: { label: "Order ID", type: "number" },
    status: { label: "Status", type: "text" },
  },
};

describe("DatasetColumnsTable", () => {
  it("renders a row per schema field with name and type", () => {
    render(<DatasetColumnsTable schema={schema} />);
    const table = screen.getByTestId("dataset-columns-table");
    expect(within(table).getByText("order_id")).toBeInTheDocument();
    expect(within(table).getByText("number")).toBeInTheDocument();
    expect(within(table).getByText("status")).toBeInTheDocument();
    expect(within(table).getByText("text")).toBeInTheDocument();
  });

  it("renders an empty-state when the schema has no fields", () => {
    render(<DatasetColumnsTable schema={{ fields: {} }} />);
    expect(screen.getByTestId("dataset-columns-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("dataset-columns-table")).not.toBeInTheDocument();
  });
});
