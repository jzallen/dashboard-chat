import {
  DOMAIN_EVENT_TYPES,
  isDomainEvent,
  UI_DIRECTIVE_TYPES,
} from "@dashboard-chat/shared-chat/domainEvents";

import type { ChatEvent } from "./events";

// Re-export the schema-derived classifier for callers that already import via
// this module; the canonical home is `shared/chat/domainEvents.ts`.
export { DOMAIN_EVENT_TYPES, isDomainEvent, UI_DIRECTIVE_TYPES };

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
