import { describe, expect, it } from "vitest";

import { getConversationalSystemPrompt,getSystemPrompt, getViewSystemPrompt } from "../../lib/chat/prompts";
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

  it("contextType 'dataset' returns dataset tools", () => {
    const tools = getTools(baseSchema());
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("sortTable");
    expect(toolNames).toContain("addRow");
    expect(toolNames).toContain("deleteRow");
    expect(toolNames).toContain("filterTable");
    expect(toolNames).toContain("clearFilters");

    // Should NOT contain view tools
    expect(toolNames).not.toContain("createView");
    expect(toolNames).not.toContain("addJoin");
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
});
