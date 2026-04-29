import { type Tool, tool } from "ai";
import { z } from "zod";

import type { Emit } from "./_helpers";
import type { DispatchContext } from "./index";

const FILTER_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "startsWith",
  "endsWith",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
] as const;

const FilterArgSchema = z.object({
  operator: z.enum(FILTER_OPERATORS),
  value: z.unknown(),
});

export function makeSortTableDispatcher(
  emit: Emit,
  _ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Sort the table by a column. Emits a sort_directive event the FE " +
      "applies locally. No backend call.",
    inputSchema: z.object({
      column: z.string().describe("Column id to sort by"),
      direction: z
        .enum(["asc", "desc"])
        .describe("Sort direction: ascending or descending"),
    }),
    execute: async ({ column, direction }) => {
      emit({ type: "sort_directive", column, direction });
      return { ok: true } as const;
    },
  });
}

export function makeFilterTableDispatcher(
  emit: Emit,
  _ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Filter the table on a column with a single operator+value condition. " +
      "Emits a filter_directive event; the FE upserts the filter on the column. " +
      "No backend call.",
    inputSchema: z.object({
      column: z.string().describe("Column id to filter by"),
      operator: z
        .enum(FILTER_OPERATORS)
        .describe("Comparison operator"),
      value: z
        .unknown()
        .describe(
          "Value to compare against. For 'between', use [low, high].",
        ),
    }),
    execute: async ({ column, operator, value }) => {
      emit({
        type: "filter_directive",
        column,
        filters: [{ operator, value }],
      });
      return { ok: true } as const;
    },
  });
}

export function makeReplaceColumnFiltersDispatcher(
  emit: Emit,
  _ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Replace all filter conditions on a column with a new array of " +
      "operator+value conditions. Emits a filter_directive event the FE " +
      "applies via its upsert semantic (replaces existing column filters). " +
      "No backend call.",
    inputSchema: z.object({
      column: z.string().describe("Column id whose filters to replace"),
      filters: z
        .array(FilterArgSchema)
        .describe("Full set of conditions for this column"),
    }),
    execute: async ({ column, filters }) => {
      emit({ type: "filter_directive", column, filters });
      return { ok: true } as const;
    },
  });
}

export function makeClearFiltersDispatcher(
  emit: Emit,
  _ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Clear all active filters from the table. Emits a filters_cleared " +
      "event. No backend call.",
    inputSchema: z.object({}),
    execute: async () => {
      emit({ type: "filters_cleared" });
      return { ok: true } as const;
    },
  });
}
