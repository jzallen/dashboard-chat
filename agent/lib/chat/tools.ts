import { tool } from "ai";
import { z } from "zod";

import { CASE_OPERATIONS, type TableSchema } from "./types";

/**
 * Tools available in conversational mode (no dataset/view context).
 * Includes resolve_dataset so the LLM can request dataset resolution
 * when the user references a dataset by name.
 */
export function getConversationalTools() {
  return {
    resolve_dataset: tool({
      description:
        "Resolve a dataset by name. Use this when the user references a dataset by name " +
        "(e.g. 'show me the patients table', 'filter the sales data') and no dataset context " +
        "is currently active. The frontend will search for a matching dataset and re-submit " +
        "the request with the resolved schema.",
      parameters: z.object({
        name: z.string().describe("The dataset name the user is referring to"),
      }),
    }),
  };
}

export function getTools(tableSchema: TableSchema) {
  const columnNames = tableSchema.columns.map((c) => c.id);
  const textColumnNames = tableSchema.columns
    .filter((c) => c.type === "string")
    .map((c) => c.id);
  const activeTransformIds =
    tableSchema.activeCleaningTransforms?.map((t) => t.id) ?? [];
  const columnDescriptions = tableSchema.columns
    .map((c) => `"${c.id}" (${c.type})`)
    .join(", ");

  // Helper to create a column enum — falls back to z.string() if no columns
  const colEnum = (cols: string[]) =>
    cols.length > 0
      ? z.enum(cols as [string, ...string[]])
      : z.string();

  return {
    sortTable: tool({
      description: `Sort table by a column. Available columns: ${columnDescriptions}`,
      parameters: z.object({
        column: colEnum(columnNames).describe("Column ID to sort by"),
        direction: z.enum(["asc", "desc"]).describe("Sort direction: ascending or descending"),
      }),
    }),
    addRow: tool({
      description: `Add a new row to the table. Columns: ${columnDescriptions}`,
      parameters: z.object({
        data: z.record(z.unknown()).describe("Key-value pairs for the new row. Keys should match column IDs."),
      }),
    }),
    deleteRow: tool({
      description: "Delete a row from the table by searching for matching text across all columns.",
      parameters: z.object({
        search: z.string().describe("Text to search for. Matches against any column value in the row."),
      }),
    }),
    clearFilters: tool({
      description: "Remove all active filters from the table",
      parameters: z.object({}),
    }),
    clearSort: tool({
      description: "Remove sorting from the table",
      parameters: z.object({}),
    }),
    filterTable: tool({
      description: `Add a filter to the table. Use this to ADD a new filter condition. Available columns: ${columnDescriptions}`,
      parameters: z.object({
        column: colEnum(columnNames).describe("Column ID to filter by"),
        operator: z.enum(["equals", "notEquals", "contains", "startsWith", "endsWith", "gt", "gte", "lt", "lte", "between"])
          .describe("Comparison operator. Use gt/gte/lt/lte for numbers, contains/startsWith/endsWith for text."),
        value: z.unknown().describe("Value to compare against. Use number for numeric comparisons, string for text. For 'between', use an array of two numbers."),
      }),
    }),
    replaceColumnFilter: tool({
      description: `Replace all existing filters on a column with new condition(s). Use when the user wants to CHANGE an existing filter. Preserves filters on other columns. Available columns: ${columnDescriptions}`,
      parameters: z.object({
        column: colEnum(columnNames).describe("Column to replace filters on"),
        filters: z.array(z.object({
          operator: z.enum(["equals", "notEquals", "contains", "startsWith", "endsWith", "gt", "gte", "lt", "lte", "between"]),
          value: z.unknown().describe("Value to compare against"),
        })).describe("ALL desired conditions for this column (include unchanged ones too)"),
      }),
    }),
    trimWhitespace: tool({
      description: "Trim leading and trailing whitespace from all values in a text column. This previews the change — always pair with applyCleaningTransform in the same response to persist it.",
      parameters: z.object({
        column: colEnum(textColumnNames).describe("Text column to trim whitespace from"),
      }),
    }),
    standardizeCase: tool({
      description: "Standardize text casing in a column (upper, lower, or title case). This previews the change — always pair with applyCleaningTransform in the same response to persist it.",
      parameters: z.object({
        column: colEnum(textColumnNames).describe("Text column to standardize casing on"),
        mode: z.enum([...CASE_OPERATIONS] as [string, ...string[]]).describe("Case mode: upper (ALL CAPS), lower (all lowercase), title (First Letter Caps), snake (snake_case), kebab (kebab-case)"),
      }),
    }),
    renameColumn: tool({
      description: "Rename a column's display name (creates an alias). This applies immediately without preview.",
      parameters: z.object({
        column: colEnum(columnNames).describe("Column to rename"),
        newName: z.string().describe("New display name for the column"),
      }),
    }),
    fillNulls: tool({
      description: "Fill null or empty values in a column with a specified value. This previews the change — always pair with applyCleaningTransform in the same response to persist it.",
      parameters: z.object({
        column: colEnum(columnNames).describe("Column to fill null values in"),
        fillValue: z.string().describe("Value to replace nulls/empty values with"),
      }),
    }),
    mapValues: tool({
      description: "Map specific values in a column to new values (exact match replacement). This previews the change — always pair with applyCleaningTransform in the same response to persist it.",
      parameters: z.object({
        column: colEnum(textColumnNames).describe("Text column to map values in"),
        mappings: z.array(z.object({
          from: z.string().describe("Original value to match (exact match)"),
          to: z.string().describe("Replacement value"),
        })).describe("Array of value mappings (from → to)"),
      }),
    }),
    applyCleaningTransform: tool({
      description: "Apply a previously previewed cleaning operation permanently to the dataset. Call this after a preview tool (trimWhitespace, standardizeCase, fillNulls, mapValues) when the user confirms.",
      parameters: z.object({
        column: colEnum(columnNames).describe("Column the cleaning operation targets"),
        operation: z.enum(["trim", "upper", "lower", "title", "snake", "kebab", "fill_null", "map_values"])
          .describe("The cleaning operation to apply"),
        config: z.record(z.unknown()).describe("Operation configuration (same as the previewed operation)"),
      }),
    }),
    undoCleaningTransform: tool({
      description: "Undo a cleaning transform by disabling (reversible) or deleting (permanent) it. If no transformId is provided, targets the most recently applied cleaning transform.",
      parameters: z.object({
        action: z.enum(["disable", "delete"]).describe("Whether to disable (reversible, can re-enable later) or permanently delete the transform"),
        transformId: z.string().optional().describe("ID of the cleaning transform to undo. If omitted, undoes the most recent one."),
      }),
    }),
    reEnableCleaningTransform: tool({
      description: "Re-enable a previously disabled cleaning transform.",
      parameters: z.object({
        transformId: z.string().optional().describe("ID of the disabled cleaning transform to re-enable. If omitted, re-enables the most recently disabled one."),
      }),
    }),
  };
}
