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
  it("returns an object with all expected (non-migrated) tools", () => {
    // After worker-tool-dispatch-refactor PR 3, UI directives (sortTable,
    // filterTable, replaceColumnFilter, clearFilters, clearSort) live in
    // dispatchers/ui.ts and are registered via the dispatcherRegistry — they
    // are no longer schema-only entries here.
    const tools = getTools(baseSchema());
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("addRow");
    expect(toolNames).toContain("deleteRow");
    expect(toolNames).toContain("trimWhitespace");
    expect(toolNames).toContain("standardizeCase");
    expect(toolNames).toContain("renameColumn");
    expect(toolNames).toContain("fillNulls");
    expect(toolNames).toContain("mapValues");
    expect(toolNames).toContain("applyCleaningTransform");
    expect(toolNames).toContain("undoCleaningTransform");
    expect(toolNames).toContain("reEnableCleaningTransform");

    // UI directive tools are no longer in tools.ts (PR 3 migration).
    expect(toolNames).not.toContain("sortTable");
    expect(toolNames).not.toContain("filterTable");
    expect(toolNames).not.toContain("replaceColumnFilter");
    expect(toolNames).not.toContain("clearFilters");
    expect(toolNames).not.toContain("clearSort");
  });

  it("trimWhitespace only accepts text/string columns", () => {
    const tools = getTools(baseSchema());
    const params = tools.trimWhitespace.parameters;

    // "name" is a string column
    expect(params.safeParse({ column: "name" }).success).toBe(true);

    // "id" is a number column — should fail
    expect(params.safeParse({ column: "id" }).success).toBe(false);
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
