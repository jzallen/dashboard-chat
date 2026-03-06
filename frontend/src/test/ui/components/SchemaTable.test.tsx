import { render, screen } from "@testing-library/react";

import { createMockSchemaConfig } from "../../../__mocks__/data";
import { SchemaTable } from "../../../ui/components/DatasetView/SchemaTable";

describe("SchemaTable", () => {
  it("renders a row for each field", () => {
    const schema = createMockSchemaConfig();
    render(<SchemaTable schemaConfig={schema} />);
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
    expect(screen.getByText("Quantity")).toBeInTheDocument();
    expect(screen.getByText("In Stock")).toBeInTheDocument();
  });

  it("displays correct type badges", () => {
    const schema = createMockSchemaConfig();
    render(<SchemaTable schemaConfig={schema} />);
    expect(screen.getAllByText("text")).toHaveLength(2); // ID and Name
    expect(screen.getByText("select")).toBeInTheDocument(); // Category
    expect(screen.getAllByText("number")).toHaveLength(2); // Amount and Quantity
    expect(screen.getByText("boolean")).toBeInTheDocument(); // In Stock
  });

  it("displays nullable column", () => {
    const schema = createMockSchemaConfig();
    render(<SchemaTable schemaConfig={schema} />);
    // All fields in mock are nullable: false
    const noCells = screen.getAllByText("No");
    expect(noCells.length).toBeGreaterThanOrEqual(6);
  });

  it("shows empty state for empty schema", () => {
    render(<SchemaTable schemaConfig={{ fields: {} }} />);
    expect(screen.getByText("No fields defined")).toBeInTheDocument();
  });

  it("renders table headers", () => {
    const schema = createMockSchemaConfig();
    render(<SchemaTable schemaConfig={schema} />);
    expect(screen.getByText("Field Name")).toBeInTheDocument();
    expect(screen.getByText("Type")).toBeInTheDocument();
    expect(screen.getByText("Description")).toBeInTheDocument();
    expect(screen.getByText("Nullable")).toBeInTheDocument();
  });
});
