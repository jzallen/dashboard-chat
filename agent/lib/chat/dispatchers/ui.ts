import { type Tool, tool } from "ai";
import { z } from "zod";

import type { UiDirective } from "../events";
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

/**
 * Emits a UI directive on the SSE side AND appends it to the per-channel
 * reflect-only log (ADR-015 / dc-x3y.2.2). The log write is a side channel —
 * it does NOT go through `BackendClient.post`, preserving the worker test
 * invariant at `worker-tool-dispatch.test.ts:502-550`.
 *
 * Errors from `presentationState.append` are caught and logged. The SSE emit
 * is the user-facing contract; persistence of the reflect-only log is
 * best-effort and must not block the dispatcher's `execute` callback.
 */
function emitAndLog(ctx: DispatchContext, directive: UiDirective): void {
  ctx.emit(directive);
  if (!ctx.channelId) return;
  void ctx.presentationState.append(ctx.channelId, directive).catch((err) => {
    console.error("[agent] presentation-state append failed:", err);
  });
}

export function makeSortTableDispatcher(
  _emit: Emit,
  ctx: DispatchContext,
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
      emitAndLog(ctx, { type: "sort_directive", column, direction });
      return { ok: true } as const;
    },
  });
}

export function makeFilterTableDispatcher(
  _emit: Emit,
  ctx: DispatchContext,
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
      emitAndLog(ctx, {
        type: "filter_directive",
        column,
        filters: [{ operator, value }],
      });
      return { ok: true } as const;
    },
  });
}

export function makeReplaceColumnFiltersDispatcher(
  _emit: Emit,
  ctx: DispatchContext,
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
      emitAndLog(ctx, { type: "filter_directive", column, filters });
      return { ok: true } as const;
    },
  });
}

export function makeClearFiltersDispatcher(
  _emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Clear all active filters from the table. Emits a filters_cleared " +
      "event. No backend call.",
    inputSchema: z.object({}),
    execute: async () => {
      emitAndLog(ctx, { type: "filters_cleared" });
      return { ok: true } as const;
    },
  });
}
