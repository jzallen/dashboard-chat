// deriveStateDocument — the WHOLE-ACTOR state-document mapper (ADR-046 MR-1).
//
// ADR-046 publishes ONE `ChatAppStateDocument` (Decision 1, option 1B) over the
// single per-principal ChatApp actor: a nested `regions` map plus a hoisted set
// of top-level conveniences (phase / active_scope / bookkeeping). This mapper
// assembles that document — it does NOT introduce a parallel derivation:
//
//   regions.onboarding     = deriveOnboarding(view)     ┐  the existing per-slice
//   regions.projectContext = deriveProjectContext(view) ├─ derivations, REUSED
//   regions.sessionChat    = deriveSessionChat(view)    ┘  verbatim from
//                                                          derive-projection.ts
//
// Because each `regions.<r>` is LITERALLY the existing slice function's output,
// the migration-equivalence gate (derive-state-document.contract.test.ts) holds
// by construction: `document.regions.<r>` byte-equals the `{ state, context }`
// half of `deriveProjection(view, <wire-alias>, bk)` for every scenario.
//
// This is a PURE function — no router/HTTP wiring (that is ADR-046 MR-2). The
// document type lives here for MR-1; the shared `@dashboard-chat/ui-state-wire`
// module is MR-3 (ADR-046 Decision 2).
//
// References:
//   docs/decisions/adr-046-*.md  — StateProxy actor surface; Decision 1 (1B), §9 MR-1
//   docs/decisions/adr-044-*.md  — ChatApp coordinator; the per-slice derivation reused

import type { ActiveScope } from "../../../domain/active-scope.ts";
import { deriveActiveScope, type ReducedContext } from "../../../domain/projection.ts";
import {
  type ChatAppSnapshotView,
  deriveOnboarding,
  deriveProjectContext,
  deriveSessionChat,
  type ProjectionBookkeeping,
} from "./derive-projection.ts";

// ───────────────────────────── document shape (ADR-046 Decision 1, option 1B) ─────────────────────────────

/** Coarse lifecycle phase — the parent ChatApp region value, for routing /
 *  first-paint. NOT a region's state-of-record (consumers dispatch on
 *  `regions.<r>.state`). */
export type ChatAppPhase = "onboarding" | "project_context" | "chat" | "rejected";

/** A derived slice of one lifecycle region — the discriminated state + its
 *  reduced context (the exact shape the per-machine projection exposed). */
export interface RegionView {
  state: string;
  context: ReducedContext;
}

/** The single document `GET /state` / `/state/stream` emit (MR-2+). A STABLE
 *  DERIVED VIEW of the one per-principal ChatApp actor. */
export interface ChatAppStateDocument {
  phase: ChatAppPhase;
  /** Single authoritative active scope — the deepest-resolved region wins. */
  active_scope: ActiveScope;
  /** Monotonic per-actor change marker (aggregated over the region logs). */
  sequence_id: number;
  last_event_at: string;
  request_id: string;
  regions: {
    onboarding: RegionView;
    projectContext: RegionView;
    sessionChat: RegionView;
  };
}

/** The hoisted top-level bookkeeping triple — pre-aggregated over the three
 *  child logs (see {@link aggregateBookkeeping}) before the mapper is called. */
export type StateDocumentBookkeeping = ProjectionBookkeeping;

// ───────────────────────────── phase (parent lifecycle value → ChatAppPhase) ─────────────────────────────

/**
 * Map the parent ChatApp lifecycle value to the coarse `ChatAppPhase`.
 *
 * machine.ts lifecycle: top-level `login` / `engaged` / `user_rejected`, where
 * `engaged` nests `project_context` / `chat`. XState renders an atomic value as
 * a string and a compound value as `{ engaged: "<sub>" }`.
 *
 *   "login"                       → "onboarding"
 *   { engaged: "project_context"} → "project_context"
 *   { engaged: "chat" }           → "chat"
 *   "user_rejected"               → "rejected"
 *
 * Reads the SETTLED value only — every `/state` derivation runs after `settle()`
 * (the R3 guard), so a mid-invoke transient is never observable on the wire.
 */
export function derivePhase(view: ChatAppSnapshotView): ChatAppPhase {
  const value = view.value;
  if (typeof value === "string") {
    if (value === "user_rejected") return "rejected";
    // "login" (and any defensive atomic fallback) → onboarding.
    return "onboarding";
  }
  if (value && typeof value === "object" && "engaged" in value) {
    const sub = (value as Record<string, unknown>).engaged;
    return sub === "chat" ? "chat" : "project_context";
  }
  // Defensive: an unrecognized compound value → onboarding (first-paint safe).
  return "onboarding";
}

// ───────────────────────────── top-level active_scope (deepest-resolved region wins) ─────────────────────────────

/**
 * Resolve the single authoritative `active_scope` per ADR-046 Decision 1:
 * "the deepest-resolved region wins". The lifecycle deepens
 * onboarding → projectContext → sessionChat, so the deepest region that has
 * resolved a scope (org_id set) is authoritative.
 *
 * A region's scope is "resolved" when its derived `org.id` is set (a bare
 * onboarding with no org yields the empty scope, org_id === ""). session-chat
 * is the deepest tier because it alone can carry a `resource_*` pair; it falls
 * through to project-context (carries the project), then onboarding (org only).
 *
 * NOTE (ADR-046 left an edge underspecified): the ADR's reference snippet shows
 * a two-tier choice (projectContext-or-onboarding). The deeper sessionChat tier
 * is added here as the obvious monotonic reading of "deepest-resolved region
 * wins" — on every current scenario it yields the identical scope to the
 * two-tier form (session-chat resolves org+project only once project-context
 * has), so the gate is unaffected; it simply carries a future `resource_*`
 * faithfully when one is present.
 */
function deriveTopActiveScope(
  onboarding: RegionView,
  projectContext: RegionView,
  sessionChat: RegionView,
): ActiveScope {
  if (sessionChat.context.org.id) return deriveActiveScope(sessionChat.context);
  if (projectContext.context.org.id) return deriveActiveScope(projectContext.context);
  return deriveActiveScope(onboarding.context);
}

// ───────────────────────────── bookkeeping aggregation ─────────────────────────────

/**
 * Aggregate the per-child bookkeeping into the document's single hoisted set
 * (ADR-046 Decision 4): there is ONE actor, so ONE authoritative counter.
 *
 *   sequence_id   = sum of the child logs' lengths (monotonic — each only grows)
 *   last_event_at = max ts across the child logs
 *   request_id    = the request_id paired with that latest event
 *
 * `request_id` is the one edge the ADR phrases loosely ("the current request").
 * The obvious monotonic choice — the request_id belonging to the most-recent
 * (max-ts) event across the three logs — is used here, so it stays coherent
 * with `last_event_at`.
 */
export function aggregateBookkeeping(
  parts: ProjectionBookkeeping[],
): StateDocumentBookkeeping {
  let sequence_id = 0;
  let last_event_at = "";
  let request_id = "";
  for (const part of parts) {
    sequence_id += part.sequence_id;
    if (part.last_event_at && part.last_event_at >= last_event_at) {
      last_event_at = part.last_event_at;
      request_id = part.request_id;
    }
  }
  return { sequence_id, last_event_at, request_id };
}

// ───────────────────────────── the whole-actor mapper ─────────────────────────────

/**
 * Derive the whole-actor `ChatAppStateDocument` from a live (or rehydrated)
 * ChatApp actor snapshot view. Pure: same (view, bookkeeping) ⇒ same document.
 *
 * @param view        a live ChatApp actor's getSnapshot() (the narrow view shape)
 * @param bookkeeping the pre-aggregated hoisted triple (see {@link aggregateBookkeeping})
 */
export function deriveStateDocument(
  view: ChatAppSnapshotView,
  bookkeeping: StateDocumentBookkeeping,
): ChatAppStateDocument {
  const onboarding = deriveOnboarding(view);
  const projectContext = deriveProjectContext(view);
  const sessionChat = deriveSessionChat(view);

  return {
    phase: derivePhase(view),
    active_scope: deriveTopActiveScope(onboarding, projectContext, sessionChat),
    sequence_id: bookkeeping.sequence_id,
    last_event_at: bookkeeping.last_event_at,
    request_id: bookkeeping.request_id,
    regions: {
      onboarding: { state: onboarding.state, context: onboarding.context },
      projectContext: { state: projectContext.state, context: projectContext.context },
      sessionChat: { state: sessionChat.state, context: sessionChat.context },
    },
  };
}
