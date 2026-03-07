import { describe, expect, it } from "vitest";

import type { TableSchema } from "../types";
import { formatProfile, getSystemPrompt, getToolDefinitions } from "../prompts";

const BASIC_SCHEMA: TableSchema = {
  columns: [
    { id: "name", type: "string" },
    { id: "age", type: "number" },
    { id: "active", type: "boolean" },
    { id: "created_at", type: "date" },
  ],
  rowCount: 100,
};

describe("getToolDefinitions", () => {
  it("returns an array of tool definitions", () => {
    const tools = getToolDefinitions(BASIC_SCHEMA);
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("parameters");
    }
  });

  it("includes expected tool names", () => {
    const tools = getToolDefinitions(BASIC_SCHEMA);
    const names = tools.map((t) => t.name);
    expect(names).toContain("sortTable");
    expect(names).toContain("filterTable");
    expect(names).toContain("addRow");
    expect(names).toContain("deleteRow");
    expect(names).toContain("clearFilters");
    expect(names).toContain("clearSort");
    expect(names).toContain("replaceColumnFilter");
    expect(names).toContain("trimWhitespace");
    expect(names).toContain("standardizeCase");
    expect(names).toContain("applyCleaningTransform");
  });

  it("sortTable column enum matches schema column IDs", () => {
    const tools = getToolDefinitions(BASIC_SCHEMA);
    const sortTool = tools.find((t) => t.name === "sortTable")!;
    const params = sortTool.parameters as {
      properties: { column: { enum: string[] } };
    };
    expect(params.properties.column.enum).toEqual([
      "name",
      "age",
      "active",
      "created_at",
    ]);
  });

  it("filterTable description includes column names and types", () => {
    const tools = getToolDefinitions(BASIC_SCHEMA);
    const filterTool = tools.find((t) => t.name === "filterTable")!;
    expect(filterTool.description).toContain('"name" (string)');
    expect(filterTool.description).toContain('"age" (number)');
  });

  it("trimWhitespace column enum includes only string columns", () => {
    const tools = getToolDefinitions(BASIC_SCHEMA);
    const trimTool = tools.find((t) => t.name === "trimWhitespace")!;
    const params = trimTool.parameters as {
      properties: { column: { enum: string[] } };
    };
    expect(params.properties.column.enum).toEqual(["name"]);
  });

  it("includes activeTransformIds in undoCleaningTransform enum", () => {
    const schema: TableSchema = {
      ...BASIC_SCHEMA,
      activeCleaningTransforms: [
        { id: "t-1", column: "name", operation: "trim" },
        { id: "t-2", column: "name", operation: "upper" },
      ],
    };
    const tools = getToolDefinitions(schema);
    const undoTool = tools.find((t) => t.name === "undoCleaningTransform")!;
    const params = undoTool.parameters as {
      properties: { transformId: { enum?: string[] } };
    };
    expect(params.properties.transformId.enum).toEqual(["t-1", "t-2"]);
  });
});

describe("formatProfile", () => {
  it("returns empty string for undefined profile", () => {
    expect(formatProfile(undefined)).toBe("");
  });

  it("formats text profile with sample values and unique count", () => {
    const result = formatProfile({
      type: "text",
      sample_values: ["foo", "bar"],
      unique_count: 5,
    });
    expect(result).toContain("values: foo, bar");
    expect(result).toContain("5 unique");
  });

  it("formats text profile with only sample values", () => {
    const result = formatProfile({ type: "text", sample_values: ["a", "b"] });
    expect(result).toBe("values: a, b");
  });

  it("limits text sample values to 10", () => {
    const values = Array.from({ length: 15 }, (_, i) => `v${i}`);
    const result = formatProfile({ type: "text", sample_values: values });
    // Should only include first 10
    expect(result).toContain("v9");
    expect(result).not.toContain("v10");
  });

  it("formats number profile with range and mean", () => {
    const result = formatProfile({
      type: "number",
      min: 0,
      max: 100,
      mean: 42.567,
    });
    expect(result).toContain("range: 0 to 100");
    expect(result).toContain("mean: 42.57");
  });

  it("formats datetime profile with range", () => {
    const result = formatProfile({
      type: "datetime",
      min: "2024-01-01",
      max: "2024-12-31",
    });
    expect(result).toBe("range: 2024-01-01 to 2024-12-31");
  });

  it("formats boolean profile with true/false counts", () => {
    const result = formatProfile({
      type: "boolean",
      true_count: 60,
      false_count: 40,
    });
    expect(result).toContain("true: 60");
    expect(result).toContain("false: 40");
  });

  it("returns empty string for unknown type", () => {
    expect(formatProfile({ type: "unknown" })).toBe("");
  });
});

describe("getSystemPrompt", () => {
  it("includes column names and types", () => {
    const prompt = getSystemPrompt(BASIC_SCHEMA);
    expect(prompt).toContain('"name" (string)');
    expect(prompt).toContain('"age" (number)');
    expect(prompt).toContain('"active" (boolean)');
    expect(prompt).toContain('"created_at" (date)');
  });

  it("includes row count", () => {
    const prompt = getSystemPrompt(BASIC_SCHEMA);
    expect(prompt).toContain("Total rows: 100");
  });

  it("shows 'No active filters' when none are set", () => {
    const prompt = getSystemPrompt(BASIC_SCHEMA);
    expect(prompt).toContain("No active filters.");
  });

  it("shows active filters when present", () => {
    const schema: TableSchema = {
      ...BASIC_SCHEMA,
      activeFilters: [{ column: "age", operator: "gt", value: 25 }],
    };
    const prompt = getSystemPrompt(schema);
    expect(prompt).toContain("ACTIVE FILTERS:");
    expect(prompt).toContain("age gt 25");
  });

  it("shows active cleaning transforms when present", () => {
    const schema: TableSchema = {
      ...BASIC_SCHEMA,
      activeCleaningTransforms: [
        { id: "t-1", column: "name", operation: "trim", details: "leading/trailing" },
      ],
    };
    const prompt = getSystemPrompt(schema);
    expect(prompt).toContain("ACTIVE CLEANING TRANSFORMS:");
    expect(prompt).toContain("[t-1] name: trim (leading/trailing)");
  });

  it("uses alias in column description when present", () => {
    const schema: TableSchema = {
      columns: [{ id: "col_a", type: "string", alias: "Column A" }],
      rowCount: 10,
    };
    const prompt = getSystemPrompt(schema);
    expect(prompt).toContain('"Column A" (string, actual column: col_a)');
  });

  it("includes profile information in column descriptions", () => {
    const schema: TableSchema = {
      columns: [
        {
          id: "price",
          type: "number",
          profile: { type: "number", min: 5, max: 500, mean: 100 },
        },
      ],
      rowCount: 50,
    };
    const prompt = getSystemPrompt(schema);
    expect(prompt).toContain("range: 5 to 500");
    expect(prompt).toContain("mean: 100.00");
  });
});
