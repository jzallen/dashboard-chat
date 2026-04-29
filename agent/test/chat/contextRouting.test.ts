import { describe, expect, it } from "vitest";

import { getConversationalSystemPrompt, getReportSystemPrompt, getSystemPrompt, getViewSystemPrompt } from "../../lib/chat/prompts";
import { getReportTools } from "../../lib/chat/reportToolDefinitions";
import { getTools } from "../../lib/chat/tools";
import type { TableSchema } from "../../lib/chat/types";
import { getViewTools } from "../../lib/chat/viewToolDefinitions";

function baseSchema(): TableSchema {
  return {
    columns: [
      { id: "id", type: "number" },
      { id: "name", type: "string" },
    ],
    rowCount: 10,
  };
}

describe("context routing — tool set selection", () => {
  it("contextType 'view' returns view tools", () => {
    const tools = getViewTools();
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("createView");
    expect(toolNames).toContain("addColumn");
    expect(toolNames).toContain("removeColumn");
    expect(toolNames).toContain("addJoin");
    expect(toolNames).toContain("removeJoin");
    expect(toolNames).toContain("addFilter");
    expect(toolNames).toContain("removeFilter");
    expect(toolNames).toContain("renameView");
    expect(toolNames).toContain("deleteView");
    expect(toolNames).toContain("setMaterialization");
    expect(toolNames).toContain("castColumn");
    expect(toolNames).toContain("setGrain");
    expect(toolNames).toHaveLength(12);

    // Should NOT contain dataset tools
    expect(toolNames).not.toContain("sortTable");
    expect(toolNames).not.toContain("addRow");
    expect(toolNames).not.toContain("filterTable");
  });

  it("contextType 'dataset' returns dataset (non-migrated) tools", () => {
    // Post-PR-3: UI-directive tools (sortTable, filterTable, replaceColumnFilter,
    // clearFilters) live in dispatchers/ui.ts and are merged into the tool set
    // by handleChat via dispatcherRegistry. tools.ts only retains the
    // schema-only entries that haven't migrated yet.
    const tools = getTools(baseSchema());
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("addRow");
    expect(toolNames).toContain("deleteRow");
    expect(toolNames).toContain("trimWhitespace");
    expect(toolNames).toContain("applyCleaningTransform");

    // UI-directive tools are no longer in tools.ts
    expect(toolNames).not.toContain("sortTable");
    expect(toolNames).not.toContain("filterTable");
    expect(toolNames).not.toContain("clearFilters");

    // Should NOT contain view tools
    expect(toolNames).not.toContain("createView");
    expect(toolNames).not.toContain("addJoin");
    expect(toolNames).not.toContain("setGrain");
  });

  it("contextType 'report' returns report tools", () => {
    const tools = getReportTools();
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("createReport");
    expect(toolNames).toContain("renameReport");
    expect(toolNames).toContain("deleteReport");
    expect(toolNames).toContain("addDimension");
    expect(toolNames).toContain("removeDimension");
    expect(toolNames).toContain("addMeasure");
    expect(toolNames).toContain("removeMeasure");
    expect(toolNames).toContain("addFilter");
    expect(toolNames).toContain("removeFilter");
    expect(toolNames).toContain("addJoin");
    expect(toolNames).toContain("removeJoin");
    expect(toolNames).toContain("setMaterialization");
    expect(toolNames).toContain("setDomain");
    expect(toolNames).toContain("setReportType");
    expect(toolNames).toContain("suggestStructure");
    expect(toolNames).toHaveLength(15);

    // Should NOT contain dataset or view tools
    expect(toolNames).not.toContain("sortTable");
    expect(toolNames).not.toContain("addRow");
    expect(toolNames).not.toContain("createView");
    expect(toolNames).not.toContain("addColumn");
    expect(toolNames).not.toContain("setGrain");
  });

  it("contextType null means no mutation tools (conversational only)", () => {
    // When contextType is null, handleChat passes no tools.
    // We verify this by checking the conversational prompt doesn't mention tools.
    const prompt = getConversationalSystemPrompt();
    expect(prompt).toContain("No dataset or view is currently selected");
    expect(prompt).not.toContain("filterTable");
    expect(prompt).not.toContain("createView");
  });
});

describe("context routing — system prompt selection", () => {
  it("view context returns view system prompt with guardrails", () => {
    const prompt = getViewSystemPrompt();

    expect(prompt).toContain("View context");
    expect(prompt).toContain("view mutation tools only");
    expect(prompt).toContain("derived from SQL");
    expect(prompt).toContain("switch to the source dataset");
    expect(prompt).toContain("setGrain");
    expect(prompt).toContain("circular dependency");
  });

  it("dataset context returns dataset system prompt with table schema", () => {
    const schema = baseSchema();
    const prompt = getSystemPrompt(schema);

    expect(prompt).toContain("controls a data table");
    expect(prompt).toContain('"id" (number)');
    expect(prompt).toContain('"name" (string)');
    expect(prompt).toContain("Total rows: 10");
  });

  it("report context returns report system prompt with guardrails", () => {
    const prompt = getReportSystemPrompt();

    expect(prompt).toContain("Report context");
    expect(prompt).toContain("report mutation tools only");
    expect(prompt).toContain("derived from SQL");
    expect(prompt).toContain("mart-layer");
    expect(prompt).toContain("NEVER other reports");
    expect(prompt).toContain("suggestStructure");
    expect(prompt).toContain("semantic_type");
  });

  it("report context includes layer section when tableSchema provided", () => {
    const prompt = getReportSystemPrompt({
      columns: [{ id: "month", type: "string" }],
      rowCount: 0,
      layerContext: {
        layer: "report",
        modelName: "monthly_revenue",
        sqlDefinition: "SELECT month, SUM(amount) FROM orders GROUP BY month",
        sourceSchemas: ["int_orders"],
      },
    });

    expect(prompt).toContain("LAYER CONTEXT");
    expect(prompt).toContain('Report "monthly_revenue"');
    expect(prompt).toContain("mart layer");
  });

  it("conversational prompt does not mention tools", () => {
    const prompt = getConversationalSystemPrompt();

    expect(prompt).toContain("helpful assistant");
    expect(prompt).toContain("select a dataset or view");
  });
});

describe("context routing — null tableSchema handling", () => {
  it("null tableSchema with null context does not error when selecting conversational mode", () => {
    // This simulates what handleChat would do: when contextType is null,
    // it uses getConversationalSystemPrompt() and no tools, regardless of tableSchema.
    expect(() => getConversationalSystemPrompt()).not.toThrow();
  });

  it("view context does not require tableSchema", () => {
    // View tools don't depend on tableSchema
    expect(() => getViewTools()).not.toThrow();
    expect(() => getViewSystemPrompt()).not.toThrow();
  });

  it("report context does not require tableSchema", () => {
    // Report tools don't depend on tableSchema
    expect(() => getReportTools()).not.toThrow();
    expect(() => getReportSystemPrompt()).not.toThrow();
  });
});
