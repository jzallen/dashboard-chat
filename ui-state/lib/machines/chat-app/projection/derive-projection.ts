// deriveProjection — the DERIVED-VIEW projection mapper (ADR-044 §2, review §4).
//
// Produces the EXISTING per-machine `FlowProjection` (ADR-027 wire contract)
// from a ChatApp actor snapshot — BYTE-IDENTICAL to today's log-folded
// `buildProjection` output, sourced from actor STATE instead of an event log.
//
// This is the bridge that lets ChatApp become the internal state-of-record
// (Phase 3) WITHOUT touching the external `GET /flow/{machine}/projection`
// envelope the FE root loader + route loaders + auth-proxy KPI sniffer read.
// The wire bytes do not change; only their SOURCE does. The contract is FROZEN
// — we DERIVE it, we do not redesign it (ADR-044 §D).
//
// How byte-identity is held:
//   - state/context/active_scope come from the relevant CHILD slice of the
//     snapshot (the child machines were named to the projection's state
//     vocabulary, so child.value → projection `state` is a documented, tested
//     mapping — mostly identity).
//   - `context` is built from `initialContext()` (the SAME zero-event defaults
//     buildProjection folds from), then only the fields the per-machine event
//     handlers would have written are overridden — so every field this mapper
//     does NOT touch matches the log fold's default byte-for-byte.
//   - `active_scope` reuses the SAME tiered `deriveActiveScope` buildProjection
//     uses (not duplicated divergently — ADR-044 §C1).
//   - `sequence_id` / `last_event_at` / `request_id` are bookkeeping the
//     RETAINED append-only log supplies (still appended for SSE/audit, ADR-044
//     §2); the caller passes them in via `bookkeepingFromLog(events)`. Sourcing
//     them from the log (not the snapshot) keeps the SSE cursor coherent while
//     STATE has no "forgot-to-emit" gap (the snapshot is the truth for state).
//
// The freeze overlay: while ChatApp's `connectivity` region is `frozen`, the
// J-002 machines report `state: "freeze"` and the login flow reports
// `expired_token` — exactly as the log-folded `*_frozen` / `token_expired`
// handlers do today (the children themselves are NOT frozen by ChatApp; the
// overlay is a parent-level read concern).
//
// Pure: same (snapshot, wireMachineName, bookkeeping) ⇒ same FlowProjection.

import type { ResourceType } from "../../../domain/active-scope.ts";
import type { FlowEvent } from "../../../domain/flow-event.ts";
import type { FlowProjection } from "../../../domain/flow-projection.ts";
import {
  deriveActiveScope,
  initialContext,
  type ReducedContext,
} from "../../../domain/projection.ts";
import type { ChatAppChildId, OnboardingResult } from "../setup/types.ts";

// ───────────────────────────── wire machine names ─────────────────────────────
// The THREE wire machine names the FE + auth-proxy + acceptance harness hit at
// `GET /ui-state/flow/{machine}/projection` (ADR-040/041 aliases preserved —
// review R7). `flow_id` is synthesized `{wireMachineName}:{principal}` verbatim,
// exactly as `FlowId.of(machine, principal).toKey()` mints it today (the alias
// segment is NOT canonicalized into the key — see flow-id.test.ts).

export const LOGIN_AND_ORG_SETUP = "login-and-org-setup";
export const PROJECT_AND_CHAT_SESSION_MANAGEMENT =
  "project-and-chat-session-management";
export const SESSION_CHAT = "session-chat";

/** Resolve a wire machine name (alias OR canonical) → the ChatApp child id whose
 *  slice backs it. Mirrors the orchestrator's MACHINE_NAME_ALIASES so the
 *  derived view resolves the same names the log-fold path does. */
const WIRE_TO_CHILD: Readonly<Record<string, ChatAppChildId>> = {
  [LOGIN_AND_ORG_SETUP]: "session-onboarding",
  "session-onboarding": "session-onboarding",
  [PROJECT_AND_CHAT_SESSION_MANAGEMENT]: "project-context",
  "project-context": "project-context",
  [SESSION_CHAT]: "session-chat",
};

export class UnknownWireMachineError extends Error {
  constructor(machine: string) {
    super(`deriveProjection: unknown wire machine name '${machine}'`);
    this.name = "UnknownWireMachineError";
  }
}

// ───────────────────────────── snapshot input shape ─────────────────────────────
// The minimal shape deriveProjection reads off a LIVE ChatApp actor snapshot —
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
  value: { lifecycle: unknown; connectivity: unknown };
  context: { principal_id: string; onboarding_result: OnboardingResult | null };
  children: Partial<Record<ChatAppChildId, ChildActorLike | undefined>>;
}

function readChild(
  snapshot: ChatAppSnapshotView,
  childId: ChatAppChildId,
): ChildSnapshotLike | undefined {
  return snapshot.children[childId]?.getSnapshot();
}

// ─────────────────────────── per-machine child context views ───────────────────────────
// Narrow reads of each child's machine context (the children are structurally
// wider; these name only the fields the projection's `context` carries).

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

// ─────────────────────── child.value → projection state (the tested map) ───────────────────────
// The children were NAMED to the projection's ~21-state vocabulary (ADR-044),
// so the map is overwhelmingly identity. Each table is explicit (per the task's
// "build an explicit, tested mapping table — do NOT assume") so a future child
// rename surfaces here as a miss rather than silently passing an off-contract
// value through. Two child-only states have NO log-fold equivalent and are
// flagged below; they are transient and never the persisted (settled) state.

const ONBOARDING_STATE_MAP: Readonly<Record<string, string>> = {
  verifying: "verifying",
  needs_org: "needs_org",
  creating_org: "creating_org",
  ready: "ready",
  error_recoverable: "error_recoverable",
  // `error_terminal` is a child-only state: NO buildProjection handler emits it,
  // so it has no log-fold equivalent. Off-contract (no FE/auth-proxy read);
  // passed through verbatim if ever reached. Not a Phase-3 contract state.
  error_terminal: "error_terminal",
  session_rejected: "session_rejected",
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

// ─────────────────────────────── per-machine derivation ───────────────────────────────

/** login-and-org-setup ← session-onboarding child (or the retained outcome once
 *  the phase-scoped child is stopped on the advance to engaged/rejected). */
function deriveOnboarding(
  snapshot: ChatAppSnapshotView,
  frozen: boolean,
): { state: string; context: ReducedContext } {
  const context = initialContext();
  const child = readChild(snapshot, "session-onboarding");

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
    const base = mapState(ONBOARDING_STATE_MAP, child.value as string);
    // Freeze overlay: a live login flow shows `expired_token` while frozen
    // (matching the log fold's `token_expired` handler). A terminal
    // session_rejected stays rejected.
    const state = frozen && base !== "session_rejected" ? "expired_token" : base;
    return { state, context };
  }

  // Child stopped (advanced past onboarding) → the retained outcome IS the
  // state-of-record for this slice (ADR-044 §2).
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
    const state =
      frozen && result.state === "ready" ? "expired_token" : result.state;
    return { state, context };
  }

  // Neither a live child nor a retained outcome → zero-event projection. (Not
  // reachable in normal flow: onboarding is invoked from t=0 and its outcome is
  // retained on exit.)
  return { state: "verifying", context };
}

/** project-and-chat-session-management ← project-context child. */
function deriveProjectContext(
  snapshot: ChatAppSnapshotView,
  frozen: boolean,
): { state: string; context: ReducedContext } {
  const context = initialContext();
  const child = readChild(snapshot, "project-context");

  // Not yet engaged (still onboarding) OR torn down (terminal) → the per-machine
  // event log is empty, which buildProjection folds to the initial `verifying`.
  if (!child) {
    return { state: "verifying", context };
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
  if (frozen) {
    // Parent-driven freeze overlay: `freeze` over the live state, which the
    // log-fold `project_context_frozen` records as `last_live_state` (the raw
    // child state the orchestrator harvested).
    context.last_live_state = rawValue;
    return { state: "freeze", context };
  }
  return { state: mapState(PROJECT_CONTEXT_STATE_MAP, rawValue), context };
}

/** session-chat ← session-chat child. */
function deriveSessionChat(
  snapshot: ChatAppSnapshotView,
  frozen: boolean,
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
  if (frozen) {
    context.last_live_state = rawValue;
    return { state: "freeze", context };
  }
  return { state: mapState(SESSION_CHAT_STATE_MAP, rawValue), context };
}

// ─────────────────────────────── bookkeeping (from the log) ───────────────────────────────

export interface ProjectionBookkeeping {
  sequence_id: number;
  last_event_at: string;
  request_id: string;
}

/**
 * The bookkeeping fields exactly as `buildProjection` derives them from the
 * per-machine event log: `sequence_id` = event count, `last_event_at` /
 * `request_id` = the last event's (or "" when empty). The hybrid design keeps
 * these log-sourced (the log is RETAINED for SSE/audit, ADR-044 §2) while
 * state/context/active_scope come from the snapshot.
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

// ─────────────────────────────── the mapper ───────────────────────────────

/**
 * Derive the per-machine `FlowProjection` for `wireMachineName` from a ChatApp
 * actor snapshot. Byte-identical to `buildProjection(flow_id, equivalent_log)`
 * for the same logical state.
 *
 * @param snapshot         a live (or rehydrated) ChatApp actor's getSnapshot()
 * @param wireMachineName  login-and-org-setup | project-and-chat-session-management
 *                         | session-chat (canonical names also resolve)
 * @param bookkeeping      sequence_id/last_event_at/request_id from the retained
 *                         log (see {@link bookkeepingFromLog})
 */
export function deriveProjection(
  snapshot: ChatAppSnapshotView,
  wireMachineName: string,
  bookkeeping: ProjectionBookkeeping,
): FlowProjection {
  const childId = WIRE_TO_CHILD[wireMachineName];
  if (!childId) {
    throw new UnknownWireMachineError(wireMachineName);
  }
  const frozen = snapshot.value.connectivity === "frozen";

  let derived: { state: string; context: ReducedContext };
  switch (childId) {
    case "session-onboarding":
      derived = deriveOnboarding(snapshot, frozen);
      break;
    case "project-context":
      derived = deriveProjectContext(snapshot, frozen);
      break;
    case "session-chat":
      derived = deriveSessionChat(snapshot, frozen);
      break;
  }

  return {
    // `flow_id` is synthesized server-side as `{machine}:{principal}` exactly as
    // today (the FE never sends it). The wire ALIAS name is kept verbatim in the
    // key (matching FlowId.of), so legacy FE/harness reads do not 404.
    flow_id: `${wireMachineName}:${snapshot.context.principal_id}`,
    state: derived.state,
    context: derived.context as unknown as Record<string, unknown>,
    active_scope: deriveActiveScope(derived.context),
    sequence_id: bookkeeping.sequence_id,
    last_event_at: bookkeeping.last_event_at,
    request_id: bookkeeping.request_id,
  };
}
