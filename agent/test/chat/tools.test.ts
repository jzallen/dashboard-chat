import { describe, expect, it } from "vitest";

import { getTools } from "../../lib/chat/tools";
import type { TableSchema } from "../../lib/chat/types";

function baseSchema(overrides?: Partial<TableSchema>): TableSchema {
  return {
    columns: [
      { id: "id", type: "number" },
      { id: "name", type: "string" },
      { id: "category", type: "string" },
    ],
    rowCount: 10,
    ...overrides,
  };
}

describe("getTools", () => {
  it("returns an object with all expected tools", () => {
    const tools = getTools(baseSchema());
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("sortTable");
    expect(toolNames).toContain("addRow");
    expect(toolNames).toContain("deleteRow");
    expect(toolNames).toContain("clearFilters");
    expect(toolNames).toContain("clearSort");
    expect(toolNames).toContain("filterTable");
    expect(toolNames).toContain("replaceColumnFilter");
    expect(toolNames).toContain("trimWhitespace");
    expect(toolNames).toContain("standardizeCase");
    expect(toolNames).toContain("renameColumn");
    expect(toolNames).toContain("fillNulls");
    expect(toolNames).toContain("mapValues");
    expect(toolNames).toContain("applyCleaningTransform");
    expect(toolNames).toContain("undoCleaningTransform");
    expect(toolNames).toContain("reEnableCleaningTransform");
  });

  it("sortTable has description and parameters schema", () => {
    const tools = getTools(baseSchema());
    const sortTable = tools.sortTable;

    expect(sortTable.description).toContain("Sort table");
    expect(sortTable.parameters).toBeDefined();
  });

  it("filterTable column parameter accepts only valid column ids", () => {
    const tools = getTools(baseSchema());
    const params = tools.filterTable.parameters;

    // Valid column id should parse successfully
    const valid = params.safeParse({ column: "id", operator: "equals", value: 1 });
    expect(valid.success).toBe(true);

    // Invalid column id should fail
    const invalid = params.safeParse({ column: "nonexistent", operator: "equals", value: 1 });
    expect(invalid.success).toBe(false);
  });

  it("sortTable direction is constrained to asc/desc", () => {
    const tools = getTools(baseSchema());
    const params = tools.sortTable.parameters;

    expect(params.safeParse({ column: "id", direction: "asc" }).success).toBe(true);
    expect(params.safeParse({ column: "id", direction: "desc" }).success).toBe(true);
    expect(params.safeParse({ column: "id", direction: "invalid" }).success).toBe(false);
  });

  it("trimWhitespace only accepts text/string columns", () => {
    const tools = getTools(baseSchema());
    const params = tools.trimWhitespace.parameters;

    // "name" is a string column
    expect(params.safeParse({ column: "name" }).success).toBe(true);

    // "id" is a number column — should fail
    expect(params.safeParse({ column: "id" }).success).toBe(false);
  });

  it("builds column enums from the live tableSchema", () => {
    const tools = getTools({
      columns: [{ id: "price", type: "number" }, { id: "sku", type: "string" }],
      rowCount: 5,
    });
    const params = tools.filterTable.parameters;

    expect(params.safeParse({ column: "price", operator: "gt", value: 100 }).success).toBe(true);
    expect(params.safeParse({ column: "id", operator: "equals", value: 1 }).success).toBe(false);
  });

  it("falls back to z.string() when no text columns exist", () => {
    const tools = getTools({
      columns: [{ id: "qty", type: "number" }, { id: "active", type: "boolean" }],
      rowCount: 2,
    });
    // trimWhitespace should accept any string (colEnum falls back to z.string())
    const params = tools.trimWhitespace.parameters;
    expect(params.safeParse({ column: "anything" }).success).toBe(true);
  });

  it("standardizeCase mode is constrained to CASE_OPERATIONS values", () => {
    const tools = getTools(baseSchema());
    const params = tools.standardizeCase.parameters;

    for (const mode of ["upper", "lower", "title", "snake", "kebab"]) {
      expect(params.safeParse({ column: "name", mode }).success).toBe(true);
    }
    expect(params.safeParse({ column: "name", mode: "camel" }).success).toBe(false);
  });
});
