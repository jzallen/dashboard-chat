// deriveStateDocument — the WHOLE-ACTOR state-document mapper (ADR-046).
//
// ADR-046 publishes ONE `ChatAppStateDocument` (Decision 1, option 1B) over the
// single per-principal ChatApp actor: a nested `regions` map plus a hoisted set
// of top-level conveniences (phase / active_scope / bookkeeping). This module
// owns BOTH the per-region slice derivations and the whole-actor assembler:
//
//   regions.onboarding     = deriveOnboarding(view)     ┐  per-region {state,context}
//   regions.projectContext = deriveProjectContext(view) ├─ slice derivations, each
//   regions.sessionChat    = deriveSessionChat(view)    ┘  sourced from the actor snapshot
//
// The slice functions live here (ADR-046 MR-7 relocated them from the retired
// per-machine `deriveProjection` wrapper). They start from `initialContext()` —
// the SAME zero-event defaults the log fold (`buildProjection`) uses — then
// override only the fields the relevant child machine carries, so any field a
// slice does not touch matches the log-fold default byte-for-byte. That
// byte-equivalence is the contract pinned by derive-state-document.contract.test.ts
// (each region equals the `{state,context}` half of `buildProjection`'s log fold).
//
// `active_scope` reuses the SAME tiered `deriveActiveScope` the log fold uses
// (not duplicated divergently). Bookkeeping (sequence_id/last_event_at/request_id)
// is log-sourced (the append-only log carries SSE/audit); the caller supplies it
// pre-aggregated over the three child logs (see {@link aggregateBookkeeping}).
//
// Pure: same (view, bookkeeping) ⇒ same document. No router/HTTP wiring.
//
// References:
//   docs/decisions/adr-046-*.md  — StateProxy actor surface; Decision 1 (1B); §9 MR-7
//   docs/decisions/adr-044-*.md  — ChatApp coordinator; hybrid log/derived-view projection
//   docs/decisions/adr-028-*.md  — parent-ignorant children, onSnapshot hand-offs

import type { ActiveScope, ResourceType } from "../../../domain/active-scope.ts";
import type { FlowEvent } from "../../../domain/flow-event.ts";
import {
  deriveActiveScope,
  initialContext,
  type ReducedContext,
} from "../../../domain/projection.ts";
import type { ChatAppChildId, OnboardingResult } from "../setup/types.ts";

// ───────────────────────────── snapshot input shape ─────────────────────────────
// The minimal shape the slice derivations read off a LIVE ChatApp actor snapshot —
// both `actor.getSnapshot()` and a rehydrated actor's `getSnapshot()` satisfy it
// (a rehydrated actor is just a live actor again). The persisted snapshot is the
// STORE's concern (snapshot.ts), not the mapper's. Children are read by the same
// cast convention the parent guards/actions use for onSnapshot views.

interface ChildSnapshotLike {
  value: unknown;
  context: unknown;
}
interface ChildActorLike {
  getSnapshot: () => ChildSnapshotLike;
}

export interface ChatAppSnapshotView {
  // The collapsed lifecycle value (single region; no parallel connectivity
  // overlay). The mapper derives each region's state from the child slice, not
  // the parent value.
  value: unknown;
  context: { principal_id: string; onboarding_result: OnboardingResult | null };
  children: Partial<Record<ChatAppChildId, ChildActorLike | undefined>>;
}

function readChild(
  snapshot: ChatAppSnapshotView,
  childId: ChatAppChildId,
): ChildSnapshotLike | undefined {
  return snapshot.children[childId]?.getSnapshot();
}

// ─────────────────────────── per-region child context views ───────────────────────────
// Narrow reads of each child's machine context (the children are structurally
// wider; these name only the fields the region's `context` carries).

interface OnboardingChildContext {
  user: {
    email: string | null;
    display_name: string | null;
    first_name: string | null;
  };
  org: { id: string | null; name: string | null };
  underlying_cause_tag: string | null;
  org_validation_error: { kind: string; message: string } | null;
}

interface ProjectContextChildContext {
  org_id: string;
  user: { first_name: string | null };
  project: { id: string | null; name: string | null };
  underlying_cause_tag: string | null;
  pending_project_name: string;
  project_validation_error: { kind: string; message: string } | null;
  most_recent_session_per_project: Record<string, string>;
  deeplink_project_id: string | null;
  last_used_degraded_project_ids: string[];
}

interface SessionChatChildContext {
  org_id: string;
  project: { id: string | null; name: string | null };
  session_list: ReducedContext["session_list"];
  session_list_next_cursor: string | null;
  session_list_has_more: boolean;
  session_id: string | null;
  transcript: ReducedContext["transcript"];
  resource: { type: ResourceType | null; id: string | null };
  pending_resume_session_id: string | null;
  underlying_cause_tag: string | null;
  pending_first_message: string;
}

// ─────────────────────── child.value → region state (the tested map) ───────────────────────
// The children are NAMED to the projection's ~21-state vocabulary, so the map is
// overwhelmingly identity. Each table is explicit so a future child rename
// surfaces here as a miss rather than silently passing an off-contract value
// through. Two child-only states have NO log-fold equivalent and are flagged
// below; they are transient and never the persisted (settled) state.

const ONBOARDING_STATE_MAP: Readonly<Record<string, string>> = {
  // Client-reported model (ADR-049/050): the cold-start state is
  // awaiting_org_report (no server-probe `verifying`). The retired
  // verifying/creating_org/session_rejected states are dropped.
  awaiting_org_report: "awaiting_org_report",
  needs_org: "needs_org",
  ready: "ready",
  error_recoverable: "error_recoverable",
};

const PROJECT_CONTEXT_STATE_MAP: Readonly<Record<string, string>> = {
  resolving_initial_scope: "resolving_initial_scope",
  no_projects: "no_projects",
  creating_project: "creating_project",
  project_selected: "project_selected",
  switching_project: "switching_project",
  scope_mismatch_terminal: "scope_mismatch_terminal",
  error_recoverable: "error_recoverable",
};

const SESSION_CHAT_STATE_MAP: Readonly<Record<string, string>> = {
  waiting_for_project: "waiting_for_project",
  loading_session_list: "loading_session_list",
  session_list_loaded: "session_list_loaded",
  resuming_session: "resuming_session",
  session_welcome: "session_welcome",
  // `creating_session` is a transient invoke state (US-206 eager create) with
  // NO log-fold projection state — the log fold shows `session_welcome` until
  // `session_active_reached` settles. Never persisted (settled-states only);
  // passed through verbatim if derived mid-transient. Not a contract state.
  creating_session: "creating_session",
  session_active: "session_active",
  switching_dataset_context: "switching_dataset_context",
  error_recoverable: "error_recoverable",
};

function mapState(
  table: Readonly<Record<string, string>>,
  value: string,
): string {
  return table[value] ?? value;
}

// ─────────────────────────────── per-region derivation ───────────────────────────────

/** onboarding region ← onboarding child (or the retained outcome once the
 *  phase-scoped child is stopped on the advance to engaged/rejected). */
export function deriveOnboarding(
  snapshot: ChatAppSnapshotView,
): { state: string; context: ReducedContext } {
  const context = initialContext();
  const child = readChild(snapshot, "onboarding");

  if (child) {
    const c = child.context as OnboardingChildContext;
    context.user = {
      email: c.user.email,
      display_name: c.user.display_name,
      first_name: c.user.first_name,
    };
    context.org = { id: c.org.id, name: c.org.name };
    context.underlying_cause_tag = c.underlying_cause_tag ?? null;
    context.org_validation_error = c.org_validation_error ?? null;
    const state = mapState(ONBOARDING_STATE_MAP, child.value as string);
    return { state, context };
  }

  // Child stopped (advanced past onboarding) → the retained outcome IS the
  // state-of-record for this region.
  const result = snapshot.context.onboarding_result;
  if (result) {
    context.user = {
      email: result.user.email,
      display_name: result.user.display_name,
      first_name: result.user.first_name,
    };
    context.org = { id: result.org.id, name: result.org.name };
    context.underlying_cause_tag = result.underlying_cause_tag;
    context.org_validation_error = result.org_validation_error;
    return { state: result.state, context };
  }

  // Neither a live child nor a retained outcome → zero-event projection. (Not
  // reachable in normal flow: onboarding is invoked from t=0 and its outcome is
  // retained on exit.) The client-reported zero state is awaiting_org_report.
  return { state: "awaiting_org_report", context };
}

/** projectContext region ← project-context child. */
export function deriveProjectContext(
  snapshot: ChatAppSnapshotView,
): { state: string; context: ReducedContext } {
  const context = initialContext();
  const child = readChild(snapshot, "project-context");

  // Not yet engaged (still onboarding) OR torn down (terminal) → the
  // client-reported zero state is awaiting_scope_report (the project-context
  // region's cold-start "waiting for the client's scope report").
  if (!child) {
    return { state: "awaiting_scope_report", context };
  }

  const c = child.context as ProjectContextChildContext;
  // The project-context flow's log never carries the org NAME or the user's
  // email/display_name (only org.id via auth_ready + user.first_name) — so the
  // folded projection has org.name === null and email/display_name === null.
  context.user = {
    email: null,
    display_name: null,
    first_name: c.user.first_name,
  };
  context.org = { id: c.org_id || null, name: null };
  context.project = { id: c.project.id, name: c.project.name };
  context.underlying_cause_tag = c.underlying_cause_tag ?? null;
  context.project_validation_error = c.project_validation_error ?? null;
  context.pending_project_name = c.pending_project_name ?? "";
  context.deeplink_project_id = c.deeplink_project_id ?? null;
  context.most_recent_session_per_project =
    c.most_recent_session_per_project ?? {};
  if (
    Array.isArray(c.last_used_degraded_project_ids) &&
    c.last_used_degraded_project_ids.length > 0
  ) {
    context.last_used_resolution_degraded = {
      failed_project_ids: c.last_used_degraded_project_ids,
      partial_result: true,
    };
  }

  const rawValue = child.value as string;
  return { state: mapState(PROJECT_CONTEXT_STATE_MAP, rawValue), context };
}

/** sessionChat region ← session-chat child. */
export function deriveSessionChat(
  snapshot: ChatAppSnapshotView,
): { state: string; context: ReducedContext } {
  const context = initialContext();
  const child = readChild(snapshot, "session-chat");

  // Not yet in chat (or torn down) → empty log → initial `verifying`.
  if (!child) {
    return { state: "verifying", context };
  }

  const c = child.context as SessionChatChildContext;
  // session-chat receives project identity via project_ready (org.id + project);
  // org.name stays null in the fold (the inherited payload carries no org name).
  context.user = { email: null, display_name: null, first_name: null };
  context.org = { id: c.org_id || null, name: null };
  context.project = { id: c.project.id, name: c.project.name };
  context.session_list = c.session_list ?? [];
  context.session_list_next_cursor = c.session_list_next_cursor ?? null;
  context.session_list_has_more = c.session_list_has_more ?? false;
  context.session_id = c.session_id ?? null;
  context.transcript = c.transcript ?? [];
  context.resource = {
    type: c.resource?.type ?? null,
    id: c.resource?.id ?? null,
  };
  context.pending_resume_session_id = c.pending_resume_session_id ?? null;
  context.pending_first_message = c.pending_first_message ?? "";
  context.underlying_cause_tag = c.underlying_cause_tag ?? null;
  context.session_dataset_unavailable =
    c.underlying_cause_tag === "dataset_not_found";

  const rawValue = child.value as string;
  return { state: mapState(SESSION_CHAT_STATE_MAP, rawValue), context };
}

// ─────────────────────────────── bookkeeping (from the log) ───────────────────────────────

export interface ProjectionBookkeeping {
  sequence_id: number;
  last_event_at: string;
  request_id: string;
}

/**
 * The bookkeeping fields exactly as `buildProjection` derives them from an
 * event log: `sequence_id` = event count, `last_event_at` / `request_id` = the
 * last event's (or "" when empty). The hybrid design keeps these log-sourced
 * (the log carries SSE/audit) while state/context/active_scope come from the
 * snapshot. The /state document aggregates the three child logs via
 * {@link aggregateBookkeeping}.
 */
export function bookkeepingFromLog(events: FlowEvent[]): ProjectionBookkeeping {
  let last_event_at = "";
  let request_id = "";
  for (const event of events) {
    last_event_at = event.ts;
    request_id = event.request_id;
  }
  return { sequence_id: events.length, last_event_at, request_id };
}

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

/** The single document `GET /state` / `/state/stream` emit. A STABLE DERIVED
 *  VIEW of the one per-principal ChatApp actor. */
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
