import { z } from "zod";

export const FilterSchema = z.object({
  operator: z.enum([
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
  ]),
  value: z.unknown(),
});

export const ChatEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("assistant_text_delta"),
    delta: z.string(),
  }),
  z.object({
    type: z.literal("transform_applied"),
    transform_id: z.string(),
    dataset_id: z.string(),
    operation: z.enum([
      "trim",
      "upper",
      "lower",
      "title",
      "snake",
      "kebab",
      "fill_null",
      "map_values",
    ]),
    column: z.string(),
  }),
  z.object({
    type: z.literal("column_renamed"),
    dataset_id: z.string(),
    old_name: z.string(),
    new_name: z.string(),
  }),
  z.object({
    type: z.literal("row_added"),
    dataset_id: z.string(),
    row_id: z.string(),
  }),
  z.object({
    type: z.literal("row_deleted"),
    dataset_id: z.string(),
    row_id: z.string(),
  }),
  z.object({
    type: z.literal("transform_undone"),
    transform_id: z.string(),
    dataset_id: z.string(),
    mode: z.enum(["disable", "delete"]),
  }),
  z.object({
    type: z.literal("transform_re_enabled"),
    transform_id: z.string(),
    dataset_id: z.string(),
  }),
  z.object({
    type: z.literal("sort_directive"),
    column: z.string(),
    direction: z.enum(["asc", "desc"]),
  }),
  z.object({
    type: z.literal("filter_directive"),
    column: z.string(),
    filters: z.array(FilterSchema),
  }),
  z.object({
    type: z.literal("filters_cleared"),
  }),
  z.object({
    type: z.literal("error_occurred"),
    phase: z.enum([
      "auth",
      "authz",
      "backend_dispatch",
      "validation",
      "groq",
      "unknown",
    ]),
    message: z.string(),
    failed_tool: z.string().optional(),
    retryable: z.boolean(),
  }),
  z.object({
    type: z.literal("turn_done"),
    reason: z.enum(["stop", "length", "request", "error"]),
  }),
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;
export type Filter = z.infer<typeof FilterSchema>;
