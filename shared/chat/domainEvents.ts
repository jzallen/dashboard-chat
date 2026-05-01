// Replay-scope DomainEvent allowlist (ADR-014). Single source of truth for both
// the agent (TS persistence gate) and the backend (Python replay-endpoint
// filter). The Python mirror at
// `backend/app/use_cases/session/_domain_event_types_generated.py` is emitted
// from this file by `npm run codegen:domain-events`.

import {
  type ChatEvent,
  DomainEventSchema,
  UiDirectiveSchema,
} from "./events";

/**
 * Variants of `DomainEventSchema` that are *out* of replay/persistence scope.
 *
 * `assistant_text_delta` is text-streaming infrastructure, not a state-change
 * outcome — Stream.io already records the assistant's final message text via
 * the upstream message itself, and replaying token deltas would only re-create
 * a transient typing animation.
 *
 * `turn_done` IS in scope (so it is *not* listed here): replay consumers need
 * the per-turn checkpoint marker to delineate turn boundaries.
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
 * automatically — and into the generated Python mirror via codegen.
 */
export const DOMAIN_EVENT_TYPES: ReadonlySet<ChatEvent["type"]> = new Set(
  DomainEventSchema.options
    .map((schema) => schema.shape.type.value as ChatEvent["type"])
    .filter((type) => !REPLAY_SCOPE_EXCLUDED.has(type)),
);

/**
 * UI directive types per ADR-014 — ephemeral renderer instructions. Explicitly
 * NOT persisted to the Stream.io thread; they are out of replay scope. Derived
 * from `UiDirectiveSchema.options` so additions to the schema flow here
 * automatically.
 */
export const UI_DIRECTIVE_TYPES: ReadonlySet<ChatEvent["type"]> = new Set(
  UiDirectiveSchema.options.map(
    (schema) => schema.shape.type.value as ChatEvent["type"],
  ),
);

export function isDomainEvent(event: ChatEvent): boolean {
  return DOMAIN_EVENT_TYPES.has(event.type);
}
