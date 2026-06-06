import { type Tool,tool } from "ai";
import { z } from "zod";

import { auditTagForOperation } from "../toolCallTags";
import { CASE_OPERATIONS } from "../types";
import {
  type Emit,
  persistToolCall,
  readBackendId,
  requireDatasetId,
  runWithEmit,
} from "./_helpers";
import type { DispatchContext } from "./index";

type CleaningOperation =
  | "trim"
  | "upper"
  | "lower"
  | "title"
  | "snake"
  | "kebab"
  | "fill_null"
  | "map_values";

const CASE_OPERATION_SET = new Set<CleaningOperation>(
  CASE_OPERATIONS as readonly CleaningOperation[],
);

function transformTypeFor(operation: CleaningOperation): "clean" | "map" {
  return operation === "map_values" ? "map" : "clean";
}

function expressionConfigFor(
  operation: CleaningOperation,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (CASE_OPERATION_SET.has(operation)) {
    return { operation: "case", mode: operation, ...config };
  }
  return { operation, ...config };
}

async function dispatchCleaningCall(args: {
  ctx: DispatchContext;
  emit: Emit;
  failedTool: string;
  column: string;
  operation: CleaningOperation;
  config: Record<string, unknown>;
}) {
  const { ctx, emit, failedTool, column, operation, config } = args;
  const guard = requireDatasetId(emit, failedTool, ctx.datasetId);
  if (!guard.ok) return guard;

  const expression_config = expressionConfigFor(operation, config);
  const transform_type = transformTypeFor(operation);

  return runWithEmit<{ transform_id: string }>(emit, failedTool, async () => {
    // Option A (rich-catalog §2.7): persist the assistant tool-call as an audit
    // entry FIRST so the transform can point UP at it (reversed FK). Best-effort
    // — a log miss must not abort the transform.
    const assistant_audit_entry_id = await persistToolCall(ctx, {
      tool: failedTool,
      say: `${operation} on ${column}`,
      tag: auditTagForOperation(operation),
    });

    const raw = await ctx.backend.post(
      `/api/datasets/${guard.datasetId}/transforms`,
      {
        transforms: [
          {
            name: `${operation} on ${column}`,
            transform_type,
            target_column: column,
            expression_config,
            ...(assistant_audit_entry_id ? { assistant_audit_entry_id } : {}),
          },
        ],
      },
    );
    const transform_id = readBackendId(raw, "worker");
    emit({
      type: "transform_applied",
      transform_id,
      dataset_id: guard.datasetId,
      operation,
      column,
    });
    return { ok: true, transform_id };
  });
}

export function makeApplyCleaningTransformDispatcher(
  emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Apply a cleaning operation permanently to the dataset. The worker " +
      "calls the backend transform endpoint and emits a typed transform_applied " +
      "event on success or error_occurred on failure.",
    inputSchema: z.object({
      column: z.string().describe("Column the cleaning operation targets"),
      operation: z
        .enum([
          "trim",
          "upper",
          "lower",
          "title",
          "snake",
          "kebab",
          "fill_null",
          "map_values",
        ])
        .describe("The cleaning operation to apply"),
      config: z
        .record(z.unknown())
        .optional()
        .describe("Operation configuration (fillValue, mappings, etc.)"),
    }),
    execute: async ({ column, operation, config }) =>
      dispatchCleaningCall({
        ctx,
        emit,
        failedTool: "applyCleaningTransform",
        column,
        operation: operation as CleaningOperation,
        config: (config ?? {}) as Record<string, unknown>,
      }),
  });
}

export function makeTrimWhitespaceDispatcher(
  emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Trim leading and trailing whitespace from all values in a text column. " +
      "Worker dispatches preview+apply as one operation and emits transform_applied.",
    inputSchema: z.object({
      column: z.string().describe("Text column to trim whitespace from"),
    }),
    execute: async ({ column }) =>
      dispatchCleaningCall({
        ctx,
        emit,
        failedTool: "trimWhitespace",
        column,
        operation: "trim",
        config: {},
      }),
  });
}

export function makeStandardizeCaseDispatcher(
  emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Standardize text casing in a column (upper, lower, title, snake, kebab). " +
      "Worker dispatches preview+apply as one operation and emits transform_applied.",
    inputSchema: z.object({
      column: z.string().describe("Text column to standardize casing on"),
      mode: z
        .enum([...CASE_OPERATIONS] as [string, ...string[]])
        .describe("Case mode"),
    }),
    execute: async ({ column, mode }) =>
      dispatchCleaningCall({
        ctx,
        emit,
        failedTool: "standardizeCase",
        column,
        operation: mode as CleaningOperation,
        config: {},
      }),
  });
}

export function makeFillNullsDispatcher(
  emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Fill null or empty values in a column with a specified value. " +
      "Worker dispatches preview+apply as one operation and emits transform_applied.",
    inputSchema: z.object({
      column: z.string().describe("Column to fill null values in"),
      fillValue: z.string().describe("Value to replace nulls/empty with"),
    }),
    execute: async ({ column, fillValue }) =>
      dispatchCleaningCall({
        ctx,
        emit,
        failedTool: "fillNulls",
        column,
        operation: "fill_null",
        config: { fill_value: fillValue },
      }),
  });
}

export function makeMapValuesDispatcher(
  emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Map specific values in a column to new values (exact match replacement). " +
      "Worker dispatches preview+apply as one operation and emits transform_applied.",
    inputSchema: z.object({
      column: z.string().describe("Text column to map values in"),
      mappings: z
        .array(
          z.object({
            from: z.string(),
            to: z.string(),
          }),
        )
        .describe("Array of value mappings (from -> to)"),
    }),
    execute: async ({ column, mappings }) =>
      dispatchCleaningCall({
        ctx,
        emit,
        failedTool: "mapValues",
        column,
        operation: "map_values",
        config: { mappings },
      }),
  });
}
