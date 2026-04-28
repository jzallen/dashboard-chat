import { type Tool,tool } from "ai";
import { z } from "zod";

import {
  type Emit,
  readBackendId,
  requireDatasetId,
  runWithEmit,
} from "./_helpers";
import type { DispatchContext } from "./index";

export function makeAddRowDispatcher(emit: Emit, ctx: DispatchContext): Tool {
  return tool({
    description:
      "Add a new row to the dataset. Worker calls the backend rows endpoint " +
      "and emits a typed row_added event with the persisted row id.",
    inputSchema: z.object({
      data: z
        .record(z.unknown())
        .describe("Key-value pairs for the new row. Keys should match column IDs."),
    }),
    execute: async ({ data }) => {
      const guard = requireDatasetId(emit, "addRow", ctx.datasetId);
      if (!guard.ok) return guard;
      return runWithEmit<{ row_id: string }>(emit, "addRow", async () => {
        const raw = await ctx.backend.post(
          `/api/datasets/${guard.datasetId}/rows`,
          { row: data },
        );
        const row_id = readBackendId(raw, "row");
        emit({
          type: "row_added",
          dataset_id: guard.datasetId,
          row_id,
        });
        return { ok: true, row_id };
      });
    },
  });
}

export function makeDeleteRowDispatcher(
  emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Delete a row from the dataset by id (or by a free-text search across " +
      "all columns when no id is supplied). Emits a typed row_deleted event.",
    inputSchema: z.object({
      row_id: z.string().optional().describe("Backend id of the row to delete"),
      search: z
        .string()
        .optional()
        .describe("Free-text search across all columns when no row_id is known"),
    }),
    execute: async ({ row_id, search }) => {
      const guard = requireDatasetId(emit, "deleteRow", ctx.datasetId);
      if (!guard.ok) return guard;
      return runWithEmit<{ row_id: string }>(emit, "deleteRow", async () => {
        let target = row_id;
        if (!target && search) {
          // Backend may not support search-by-text deletes; submit search as a
          // query param. Real backend should resolve to a row id. Fall back to
          // the search string itself if the backend doesn't return one.
          const raw = await ctx.backend.post(
            `/api/datasets/${guard.datasetId}/rows/delete-by-search`,
            { search },
          );
          target = readBackendId(raw, "row");
        }
        if (!target) {
          throw new Error("deleteRow: missing row_id and search");
        }
        await ctx.backend.post(
          `/api/datasets/${guard.datasetId}/rows/${encodeURIComponent(target)}/delete`,
          {},
        );
        emit({
          type: "row_deleted",
          dataset_id: guard.datasetId,
          row_id: target,
        });
        return { ok: true, row_id: target };
      });
    },
  });
}

export function makeRenameColumnDispatcher(
  emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Rename a column's display name (creates an alias transform). Emits a " +
      "typed column_renamed event with old + new names.",
    inputSchema: z.object({
      column: z.string().describe("Column to rename"),
      newName: z.string().describe("New display name for the column"),
    }),
    execute: async ({ column, newName }) => {
      const guard = requireDatasetId(emit, "renameColumn", ctx.datasetId);
      if (!guard.ok) return guard;
      return runWithEmit<{ old_name: string; new_name: string }>(
        emit,
        "renameColumn",
        async () => {
          await ctx.backend.post(
            `/api/datasets/${guard.datasetId}/transforms`,
            {
              transforms: [
                {
                  name: `Rename ${column} to ${newName}`,
                  transform_type: "alias",
                  target_column: column,
                  expression_config: { operation: "alias", alias: newName },
                },
              ],
            },
          );
          emit({
            type: "column_renamed",
            dataset_id: guard.datasetId,
            old_name: column,
            new_name: newName,
          });
          return { ok: true, old_name: column, new_name: newName };
        },
      );
    },
  });
}

export function makeUndoCleaningTransformDispatcher(
  emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Undo a cleaning transform by disabling (reversible) or deleting (permanent). " +
      "Emits a typed transform_undone event whose `mode` field carries the choice.",
    inputSchema: z.object({
      transform_id: z.string().describe("ID of the cleaning transform to undo"),
      mode: z
        .enum(["disable", "delete"])
        .describe(
          "disable = reversible (status -> disabled); delete = destructive (status -> deleted)",
        ),
    }),
    execute: async ({ transform_id, mode }) => {
      const guard = requireDatasetId(
        emit,
        "undoCleaningTransform",
        ctx.datasetId,
      );
      if (!guard.ok) return guard;
      return runWithEmit<{ transform_id: string; mode: "disable" | "delete" }>(
        emit,
        "undoCleaningTransform",
        async () => {
          const status = mode === "delete" ? "deleted" : "disabled";
          await ctx.backend.post(
            `/api/datasets/${guard.datasetId}/transforms/patch`,
            {
              updates: [{ id: transform_id, status }],
            },
          );
          emit({
            type: "transform_undone",
            transform_id,
            dataset_id: guard.datasetId,
            mode,
          });
          return { ok: true, transform_id, mode };
        },
      );
    },
  });
}

export function makeReEnableCleaningTransformDispatcher(
  emit: Emit,
  ctx: DispatchContext,
): Tool {
  return tool({
    description:
      "Re-enable a previously disabled cleaning transform. Emits a typed " +
      "transform_re_enabled event.",
    inputSchema: z.object({
      transform_id: z
        .string()
        .describe("ID of the disabled cleaning transform to re-enable"),
    }),
    execute: async ({ transform_id }) => {
      const guard = requireDatasetId(
        emit,
        "reEnableCleaningTransform",
        ctx.datasetId,
      );
      if (!guard.ok) return guard;
      return runWithEmit<{ transform_id: string }>(
        emit,
        "reEnableCleaningTransform",
        async () => {
          await ctx.backend.post(
            `/api/datasets/${guard.datasetId}/transforms/patch`,
            {
              updates: [{ id: transform_id, status: "enabled" }],
            },
          );
          emit({
            type: "transform_re_enabled",
            transform_id,
            dataset_id: guard.datasetId,
          });
          return { ok: true, transform_id };
        },
      );
    },
  });
}
