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

// ---- Domain events ----------------------------------------------------
// State-change outcomes worth replaying or persisting (ADR-014). The
// per-variant `.describe(...)` titles propagate through `zod-to-json-schema`
// so Pydantic codegen emits semantic class names (e.g. `TransformAppliedEvent`)
// instead of numeric (`DomainEvent1`). See ADR-014 OQ #1.

export const AssistantTextDeltaSchema = z
  .object({
    type: z.literal("assistant_text_delta"),
    delta: z.string(),
  })
  .describe("AssistantTextDeltaEvent");

export const TransformAppliedSchema = z
  .object({
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
  })
  .describe("TransformAppliedEvent");

export const ColumnRenamedSchema = z
  .object({
    type: z.literal("column_renamed"),
    dataset_id: z.string(),
    old_name: z.string(),
    new_name: z.string(),
  })
  .describe("ColumnRenamedEvent");

export const RowAddedSchema = z
  .object({
    type: z.literal("row_added"),
    dataset_id: z.string(),
    row_id: z.string(),
  })
  .describe("RowAddedEvent");

export const RowDeletedSchema = z
  .object({
    type: z.literal("row_deleted"),
    dataset_id: z.string(),
    row_id: z.string(),
  })
  .describe("RowDeletedEvent");

export const TransformUndoneSchema = z
  .object({
    type: z.literal("transform_undone"),
    transform_id: z.string(),
    dataset_id: z.string(),
    mode: z.enum(["disable", "delete"]),
  })
  .describe("TransformUndoneEvent");

export const TransformReEnabledSchema = z
  .object({
    type: z.literal("transform_re_enabled"),
    transform_id: z.string(),
    dataset_id: z.string(),
  })
  .describe("TransformReEnabledEvent");

export const ErrorOccurredSchema = z
  .object({
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
  })
  .describe("ErrorOccurredEvent");

export const TurnDoneSchema = z
  .object({
    type: z.literal("turn_done"),
    reason: z.enum(["stop", "length", "request", "error"]),
  })
  .describe("TurnDoneEvent");

export const DomainEventSchema = z.discriminatedUnion("type", [
  AssistantTextDeltaSchema,
  TransformAppliedSchema,
  ColumnRenamedSchema,
  RowAddedSchema,
  RowDeletedSchema,
  TransformUndoneSchema,
  TransformReEnabledSchema,
  ErrorOccurredSchema,
  TurnDoneSchema,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;

// ---- UI directives ----------------------------------------------------
// Render instructions with no backend correlate (ADR-014). Ephemeral —
// drive TanStack table render state via `applyDirective` only.

export const SortDirectiveSchema = z
  .object({
    type: z.literal("sort_directive"),
    column: z.string(),
    direction: z.enum(["asc", "desc"]),
  })
  .describe("SortDirective");

export const FilterDirectiveSchema = z
  .object({
    type: z.literal("filter_directive"),
    column: z.string(),
    filters: z.array(FilterSchema),
  })
  .describe("FilterDirective");

export const FiltersClearedSchema = z
  .object({
    type: z.literal("filters_cleared"),
  })
  .describe("FiltersClearedDirective");

export const UiDirectiveSchema = z.discriminatedUnion("type", [
  SortDirectiveSchema,
  FilterDirectiveSchema,
  FiltersClearedSchema,
]);
export type UiDirective = z.infer<typeof UiDirectiveSchema>;

// ---- Re-union for the wire (byte-identical to the pre-stratification union) -

export const ChatEventSchema = z.union([DomainEventSchema, UiDirectiveSchema]);
export type ChatEvent = DomainEvent | UiDirective;

export type Filter = z.infer<typeof FilterSchema>;
