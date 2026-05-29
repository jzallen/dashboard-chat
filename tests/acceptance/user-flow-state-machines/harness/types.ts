// Types that mirror the four-piece contract from
// `docs/feature/user-flow-state-machines/design/handoff-design-to-distill.md`.
//
// These re-declare (rather than import from) the ui-state/ scaffold types
// so the acceptance suite cannot accidentally couple to production internals.
// CM-A: tests never `from "ui-state/lib/..."` import.

// Mirrors ui-state's `ResourceType` per CM-A (no production imports from
// tests). YAGNI-collapsed to `"dataset"` alongside ui-state per ADR-039 §Q1.
export type ResourceType = "dataset";

export interface ActiveScope {
  org_id: string;
  project_id: string | null;
  resource_type: ResourceType | null;
  resource_id: string | null;
}

export interface FlowEvent {
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
}

// ────────────────────────────────────────────────────────────────────────────
// ADR-046 MR-6 — the single `/state` document surface.
//
// The three former per-machine `FlowProjection` envelopes
// (`/ui-state/flow/<machine>/projection`) are replaced by ONE
// `ChatAppStateDocument` emitted by `GET /ui-state/state`. Each former
// per-machine projection is now a `regions.*` slice of that one document; the
// single authoritative `active_scope` and the bookkeeping (`sequence_id`,
// `last_event_at`, `request_id`) are hoisted to the top level. See
// ADR-046 Decision 1B.
// ────────────────────────────────────────────────────────────────────────────

/** Coarse lifecycle phase — the parent ChatApp region value, for routing. */
export type ChatAppPhase = "onboarding" | "project_context" | "chat" | "rejected";

/** A derived slice of one lifecycle region — its discriminated state + the
 *  reduced context the old per-machine projection exposed for that region. */
export interface RegionView {
  state: string;
  context: Record<string, unknown>;
}

/** The single document `GET /ui-state/state` (and `/ui-state/state/stream`)
 *  emit. Region keys are the domain regions, not the legacy wire-machine
 *  aliases: `onboarding` (← login-and-org-setup), `projectContext`
 *  (← project-and-chat-session-management), `sessionChat` (← session-chat). */
export interface ChatAppStateDocument {
  phase: ChatAppPhase;
  active_scope: ActiveScope;
  sequence_id: number;
  last_event_at: string;
  request_id: string;
  regions: {
    onboarding: RegionView;
    projectContext: RegionView;
    sessionChat: RegionView;
  };
}

export type RegionKey = keyof ChatAppStateDocument["regions"];

/** A region slice of the `/state` document flattened into the shape the
 *  harness exposes to its callers: the region's `{state, context}` plus the
 *  document's single top-level `active_scope` and bookkeeping.
 *
 *  `flow_id` is intentionally absent — the proxy surface is addressed by
 *  header identity and the document carries no id (ADR-046 Decision 1B §3).
 *  `correlation_id` is sourced from the document's top-level `request_id`
 *  (the reference-code / support-trail handle of the last settled
 *  transition); the wire name changed, the user-observable value did not. */
export interface FlowProjection {
  state: string;
  context: Record<string, unknown>;
  active_scope: ActiveScope;
  sequence_id: number;
  last_event_at: string;
  correlation_id: string;
}

export type UnderlyingCauseTag =
  | "transient"
  | "cookie-blocked"
  | "partial-setup"
  | "workos-profile-corrupt"
  | "jwks_not_warm";
