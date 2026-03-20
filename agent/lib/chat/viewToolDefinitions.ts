import { tool } from "ai";
import { z } from "zod";

const DISPLAY_TYPES = [
  "text",
  "category",
  "id",
  "serial",
  "integer",
  "decimal",
  "boolean",
  "date",
  "time",
  "datetime",
] as const;

const JOIN_TYPES = ["INNER", "LEFT", "RIGHT", "FULL"] as const;

const FILTER_OPERATORS = [
  "=",
  "!=",
  ">",
  ">=",
  "<",
  "<=",
  "IN",
  "NOT IN",
  "IS NULL",
  "IS NOT NULL",
  "LIKE",
  "NOT LIKE",
] as const;

const MATERIALIZATION_STRATEGIES = [
  "view",
  "table",
  "ephemeral",
  "incremental",
] as const;

export function getViewTools() {
  return {
    createView: tool({
      description:
        "Create a new view from one or more source datasets or views",
      parameters: z.object({
        name: z.string().describe("Name for the new view"),
        sourceRefs: z
          .array(z.string())
          .describe("Array of source dataset/view names"),
        description: z.string().optional().describe("Optional description"),
      }),
    }),
    addColumn: tool({
      description: "Add a column to the view from a source dataset or view",
      parameters: z.object({
        sourceRef: z.string().describe("Source dataset or view name"),
        sourceColumn: z.string().describe("Column name in the source"),
        displayType: z
          .enum(DISPLAY_TYPES)
          .describe("Display type for the column"),
        alias: z.string().optional().describe("Optional alias for the column"),
      }),
    }),
    removeColumn: tool({
      description: "Remove a column from the view",
      parameters: z.object({
        columnName: z.string().describe("Name of the column to remove"),
      }),
    }),
    addJoin: tool({
      description: "Add a join to the view",
      parameters: z.object({
        rightRef: z.string().describe("Right-side source to join"),
        leftColumn: z.string().describe("Column on the left side of the join"),
        rightColumn: z
          .string()
          .describe("Column on the right side of the join"),
        joinType: z
          .enum(JOIN_TYPES)
          .optional()
          .describe("Join type (default: INNER)"),
      }),
    }),
    removeJoin: tool({
      description: "Remove a join from the view",
      parameters: z.object({
        rightRef: z
          .string()
          .describe("Right-side source of the join to remove"),
      }),
    }),
    addFilter: tool({
      description: "Add a filter condition to the view",
      parameters: z.object({
        sourceRef: z.string().describe("Source dataset or view name"),
        column: z.string().describe("Column to filter on"),
        operator: z.enum(FILTER_OPERATORS).describe("Filter operator"),
        value: z
          .string()
          .optional()
          .describe(
            "Value to compare against (omit for IS NULL / IS NOT NULL)"
          ),
      }),
    }),
    removeFilter: tool({
      description: "Remove a filter from the view by column name",
      parameters: z.object({
        column: z
          .string()
          .describe("Column whose filter should be removed"),
      }),
    }),
    renameView: tool({
      description: "Rename the current view",
      parameters: z.object({
        newName: z.string().describe("New name for the view"),
      }),
    }),
    deleteView: tool({
      description: "Delete a view",
      parameters: z.object({
        viewId: z.string().describe("ID of the view to delete"),
      }),
    }),
    setMaterialization: tool({
      description: "Set the materialization strategy for the view",
      parameters: z.object({
        strategy: z
          .enum(MATERIALIZATION_STRATEGIES)
          .describe("Materialization strategy"),
      }),
    }),
    castColumn: tool({
      description: "Change the display type of a column in the view",
      parameters: z.object({
        columnName: z.string().describe("Name of the column to cast"),
        displayType: z.enum(DISPLAY_TYPES).describe("New display type"),
      }),
    }),
    setGrain: tool({
      description:
        "Set the grain (time dimension and grouping dimensions) for the view",
      parameters: z.object({
        timeColumn: z
          .string()
          .describe("Time-typed column for the grain"),
        dimensions: z
          .array(z.string())
          .describe("Dimension columns for the grain"),
      }),
    }),
  };
}
