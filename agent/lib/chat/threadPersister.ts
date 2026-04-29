import {
  DomainEventSchema,
  UiDirectiveSchema,
} from "@dashboard-chat/shared-chat";

import type { ChatEvent } from "./events";

/**
 * Type literals excluded from replay scope even though they appear in
 * `DomainEventSchema`. Currently only `assistant_text_delta`: it is
 * text-streaming infrastructure, not a state-change outcome, and Stream.io
 * already records the assistant's final message text via the upstream message
 * itself.
 *
 * `turn_done` IS included (via the schema) — it is the per-turn checkpoint
 * marker and replay consumers need it to delineate turn boundaries.
 */
const REPLAY_SCOPE_EXCLUDED: ReadonlySet<ChatEvent["type"]> = new Set([
  "assistant_text_delta",
]);

/**
 * Domain event types per ADR-014 — "outcomes of actions taken against backend
 * state". These records are persisted onto the Stream.io thread for replay
 * (Epic C, bead dc-x3y.3.1). UI directives are explicitly out of replay scope.
 *
 * Derived from `DomainEventSchema.options` minus `REPLAY_SCOPE_EXCLUDED`, so
 * adding a new variant to `shared/chat/events.ts:DomainEventSchema` flows here
 * automatically. The Python-side mirror
 * (`backend/app/use_cases/session/event_replay.py:DOMAIN_EVENT_TYPES`) is held
 * in sync by the cross-language parity test in
 * `agent/test/chat/threadPersister.test.ts`.
 */
export const DOMAIN_EVENT_TYPES: ReadonlySet<ChatEvent["type"]> = new Set(
  DomainEventSchema.options
    .map((schema) => schema.shape.type.value as ChatEvent["type"])
    .filter((type) => !REPLAY_SCOPE_EXCLUDED.has(type)),
);

/**
 * UI directive types per ADR-014 — ephemeral renderer instructions. Explicitly
 * NOT persisted to the Stream.io thread; they are out of replay scope.
 *
 * Derived from `UiDirectiveSchema.options` so additions to the schema flow
 * here automatically.
 */
export const UI_DIRECTIVE_TYPES: ReadonlySet<ChatEvent["type"]> = new Set(
  UiDirectiveSchema.options.map(
    (schema) => schema.shape.type.value as ChatEvent["type"],
  ),
);

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
