import { type Tool,tool } from "ai";
import { z } from "zod";

import { BackendClientError } from "../backend-client";
import type { ChatEvent } from "../events";
import { CASE_OPERATIONS } from "../types";
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

type Emit = (event: ChatEvent) => void;

type DispatcherSuccess = { ok: true; transform_id: string };
type DispatcherFailure = { ok: false; error: string };
type DispatcherResult = DispatcherSuccess | DispatcherFailure;

type BackendCreateResponse = {
  id?: string;
  data?: { id?: string; transforms?: Array<{ id: string }> };
  transforms?: Array<{ id: string }>;
};

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

function readBackendId(raw: unknown): string {
  const body = raw as BackendCreateResponse | null;
  if (body && typeof body === "object") {
    if (typeof body.id === "string") return body.id;
    if (Array.isArray(body.transforms) && typeof body.transforms[0]?.id === "string") {
      return body.transforms[0].id;
    }
    if (body.data) {
      if (typeof body.data.id === "string") return body.data.id;
      if (
        Array.isArray(body.data.transforms) &&
        typeof body.data.transforms[0]?.id === "string"
      ) {
        return body.data.transforms[0].id;
      }
    }
  }
  // Backend currently returns {ok: true} only on POST /transforms — generate a
  // synthetic id so the FE has a stable handle for invalidation. Replaced when
  // the backend returns the persisted id (out of scope for this PR).
  return `worker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof BackendClientError) {
    return err.status === 0 || err.status >= 500;
  }
  return false;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function dispatchCleaningCall(args: {
  ctx: DispatchContext;
  emit: Emit;
  failedTool: string;
  column: string;
  operation: CleaningOperation;
  config: Record<string, unknown>;
}): Promise<DispatcherResult> {
  const { ctx, emit, failedTool, column, operation, config } = args;

  if (!ctx.datasetId) {
    const message = `${failedTool}: missing dataset context`;
    emit({
      type: "error_occurred",
      phase: "validation",
      message,
      failed_tool: failedTool,
      retryable: false,
    });
    return { ok: false, error: message };
  }

  const expression_config = expressionConfigFor(operation, config);
  const transform_type = transformTypeFor(operation);
  const body = {
    transforms: [
      {
        name: `${operation} on ${column}`,
        transform_type,
        target_column: column,
        expression_config,
      },
    ],
  };

  try {
    const raw = await ctx.backend.post(
      `/api/datasets/${ctx.datasetId}/transforms`,
      body,
    );
    const transform_id = readBackendId(raw);
    emit({
      type: "transform_applied",
      transform_id,
      dataset_id: ctx.datasetId,
      operation,
      column,
    });
    return { ok: true, transform_id };
  } catch (err) {
    const message = errorMessage(err);
    emit({
      type: "error_occurred",
      phase: "backend_dispatch",
      message,
      failed_tool: failedTool,
      retryable: isRetryable(err),
    });
    return { ok: false, error: message };
  }
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
