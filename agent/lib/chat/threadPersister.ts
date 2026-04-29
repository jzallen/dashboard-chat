import type { ChatEvent } from "./events";

/**
 * Domain event types per ADR-014 — "outcomes of actions taken against backend
 * state". These records are persisted onto the Stream.io thread for replay
 * (Epic C, bead dc-x3y.3.1). UI directives are explicitly out of replay scope.
 *
 * `assistant_text_delta` is excluded — it is text-streaming infrastructure,
 * not a state-change outcome, and Stream.io already records the assistant's
 * final message text via the upstream message itself.
 *
 * `turn_done` is included — it is the per-turn checkpoint marker and replay
 * consumers need it to delineate turn boundaries.
 */
export const DOMAIN_EVENT_TYPES: ReadonlySet<ChatEvent["type"]> = new Set([
  "transform_applied",
  "row_added",
  "row_deleted",
  "column_renamed",
  "transform_undone",
  "transform_re_enabled",
  "error_occurred",
  "turn_done",
]);

/**
 * UI directive types per ADR-014 — ephemeral renderer instructions. Explicitly
 * NOT persisted to the Stream.io thread; they are out of replay scope.
 */
export const UI_DIRECTIVE_TYPES: ReadonlySet<ChatEvent["type"]> = new Set([
  "sort_directive",
  "filter_directive",
  "filters_cleared",
]);

export function isDomainEvent(event: ChatEvent): boolean {
  return DOMAIN_EVENT_TYPES.has(event.type);
}

/**
 * Writes a batch of domain events onto a Stream.io thread (channel) before the
 * worker emits `turn_done`. Implementations must be best-effort: a thrown error
 * will be caught by the caller and logged, but `turn_done` will still be
 * emitted on the SSE stream so the user-facing turn is not blocked on
 * persistence (per dc-x3y.3.1 exit criterion 6).
 */
export interface ThreadEventPersister {
  persist(channelId: string, events: ChatEvent[]): Promise<void>;
}

/**
 * Default no-op persister used when Stream.io credentials are not configured
 * or when the chat request omits a thread/channel id. The worker still emits
 * `turn_done`; nothing is durably stored.
 */
export const noopThreadPersister: ThreadEventPersister = {
  async persist() {
    /* no-op */
  },
};
