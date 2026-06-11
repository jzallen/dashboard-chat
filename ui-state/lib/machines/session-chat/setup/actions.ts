// Actions for the session-chat statechart — the ONLY writers of machine context.
// Each is a bare closure, param-annotated with the shared `ActionArgs` alias
// (./types.ts); the `assign(...)` wrap happens at the `setup()` call in
// ../machine.ts, where inference flows from `setup`'s `types`.
//
// REPORT-DRIVEN (ADR-050 §e.5 / DR-8/AR-8): the settle actions read the
// client-reported OUTCOME's top-level fields (the forwardToActor seam spreads
// the wire payload to the event top level), NOT an invoke's `event.output`. The
// `*_failed` taggers read `event.cause` and record the originating live state
// for observability. The invoke-only readers (the old `event.output` casts) and
// the four `tagTransient*` / `tagListDegraded` cause-taggers are retired with the
// egress they served.
//
// project_ready reset variants (the per-state divergence is deliberate — see the
// state-by-state field table in ../README.md): the switch states share
// `resetForProjectSwitch` (identity + session-state reset); the states that carry
// a deep-link resume wish compose `+captureDeeplinkResume`; the welcome state
// composes `+clearPendingFirstMessage`; the cold-arrival `waiting_for_project`
// uses `applyProjectReady` (identity + resume wish, NO session reset).

import type {
  ActionArgs,
  ResourceType,
  SessionSummary,
  TranscriptMessage,
} from "./types.ts";

// ─────────────────────────── project_ready handlers ───────────────────────────

/** project_ready into `waiting_for_project` (cold arrival): adopt the inbound
 *  project identity and capture the deep-link resume wish. Does NOT reset the
 *  session fields — this is the first arrival, nothing to invalidate. */
export const applyProjectReady = ({ event, context }: ActionArgs) => {
  if (event.type !== "project_ready") return {};
  return {
    org_id: event.org_id,
    project: { id: event.project_id, name: event.project_name },
    request_id: event.request_id ?? context.request_id,
    pending_resume_session_id:
      event.deeplink_session_id ?? context.pending_resume_session_id,
  };
};

/** project_ready into a live state (project SWITCH): adopt the new project
 *  identity and invalidate the session-scoped context (session_id, transcript,
 *  resource, session_list) BEFORE the new project's awaiting_session_list_report.
 *  The deep-link resume wish and pending_first_message are handled by the
 *  composed `captureDeeplinkResume` / `clearPendingFirstMessage` actions where
 *  the state carries them. */
export const resetForProjectSwitch = ({ event, context }: ActionArgs) => {
  if (event.type !== "project_ready") return {};
  return {
    org_id: event.org_id,
    project: { id: event.project_id, name: event.project_name },
    request_id: event.request_id ?? context.request_id,
    session_id: null,
    transcript: [] as TranscriptMessage[],
    resource: { type: null, id: null } as {
      type: ResourceType | null;
      id: string | null;
    },
    session_list: [] as SessionSummary[],
  };
};

/** Composed onto the project switch for `awaiting_session_list_report` and
 *  `session_list_loaded`: carry the deep-link resume wish across the switch. */
export const captureDeeplinkResume = ({ event, context }: ActionArgs) => {
  if (event.type !== "project_ready") return {};
  return {
    pending_resume_session_id:
      event.deeplink_session_id ?? context.pending_resume_session_id,
  };
};

/** Composed onto the project switch for `session_welcome`: clear the preserved
 *  composer text (no-ghost-row invariant — no session row was ever created). */
export const clearPendingFirstMessage = () => ({
  pending_first_message: "",
});

// ─────────────────────────── intent / pick capture ───────────────────────────

/** session_clicked: capture the clicked session id as the pending resume
 *  target. Under the report-driven model the actual resume is reported by the
 *  client (`session_resumed`); the captured id is observability + parity. */
export const capturePendingResumeIntent = ({ event, context }: ActionArgs) => ({
  pending_resume_session_id:
    event.type === "session_clicked"
      ? event.session_id
      : context.pending_resume_session_id,
});

/** first_message_sent: preserve the composer text across
 *  session_welcome ↔ error_recoverable (and until session_created is reported). */
export const capturePendingFirstMessage = ({ event, context }: ActionArgs) => ({
  pending_first_message:
    event.type === "first_message_sent"
      ? event.content
      : context.pending_first_message,
});

/** DWD-7 — a session_clicked whose target no longer resolves in the post-THAW
 *  state is silent-dropped (observability only, no UX surface). */
export const recordStaleSessionClicked = ({ event, context }: ActionArgs) => ({
  stale_intents_dropped_count: context.stale_intents_dropped_count + 1,
  last_stale_intent: {
    intent_type: "session_clicked",
    target_id: event.type === "session_clicked" ? event.session_id : "",
  },
});

/** US-209 — capture the dataset pick from `dataset_resolved_by_agent` /
 *  `dataset_picked_directly` (observability; the switch outcome is reported by
 *  the client as `dataset_context_switched`). */
export const captureIntendedResource = ({ event, context }: ActionArgs) => ({
  intended_resource_id:
    event.type === "dataset_resolved_by_agent" ||
    event.type === "dataset_picked_directly"
      ? event.resource_id
      : context.intended_resource_id,
  intended_resource_type:
    event.type === "dataset_resolved_by_agent" ||
    event.type === "dataset_picked_directly"
      ? event.resource_type
      : context.intended_resource_type,
});

// ─────────────────────────── session list report settle ───────────────────────────

/** session_list_loaded report: land the loaded session list (the report carries
 *  the display data the retired LoadSessionListOutput used to). */
export const assignSessionList = ({ event }: ActionArgs) => {
  if (event.type !== "session_list_loaded") return {};
  return {
    session_list: event.sessions,
    session_list_next_cursor: event.next_cursor,
    session_list_has_more: event.has_more,
  };
};

/** new_session_clicked from session_list_loaded (US-206 / DWD-10 lazy-creation):
 *  enter the welcome state with session_id null; no session row exists until the
 *  client reports session_created. */
export const enterWelcomeReset = () => ({
  session_id: null,
  transcript: [] as TranscriptMessage[],
  resource: { type: null, id: null } as {
    type: ResourceType | null;
    id: string | null;
  },
  pending_first_message: "",
});

// ─────────────────────────── resume report settle ───────────────────────────

/** session_resumed report (active): atomic materialization per IC-J002-3 —
 *  transcript AND resource are populated in a SINGLE assign before transitioning
 *  to session_active. The report carries the resolved resource directly (or
 *  session_dataset_unavailable when the dataset 404'd). */
export const assignResumedSession = ({ event }: ActionArgs) => {
  if (event.type !== "session_resumed") return {};
  const unavailable = event.session_dataset_unavailable === true;
  const reported = event.resource ?? { type: null, id: null };
  const resource: { type: ResourceType | null; id: string | null } = unavailable
    ? { type: null, id: null }
    : reported;
  return {
    session_id: event.session_id,
    transcript: event.transcript,
    resource,
    underlying_cause_tag: unavailable ? ("dataset_not_found" as const) : null,
    pending_resume_session_id: null,
  };
};

// ─────────────────────────── dataset switch report settle ───────────────────────────

/** dataset_context_switched report: retarget `context.resource` to the reported
 *  resource. Single atomic assign (IC-J002-5: exactly ONE resource_* update). */
export const assignSwitchedDataset = ({ event }: ActionArgs) => {
  if (event.type !== "dataset_context_switched") return {};
  return {
    resource: event.resource,
    underlying_cause_tag: null,
    intended_resource_id: null,
    intended_resource_type: null,
  };
};

// ─────────────────────────── eager-create report settle ───────────────────────────

/** session_created report: land the created session id; transcript + resource
 *  start empty (the welcome composer's first message becomes the first turn once
 *  chat begins). */
export const assignCreatedSession = ({ event }: ActionArgs) => {
  if (event.type !== "session_created") return {};
  return {
    session_id: event.session.session_id,
    transcript: [] as TranscriptMessage[],
    resource: { type: null, id: null } as {
      type: ResourceType | null;
      id: string | null;
    },
    pending_first_message: "",
    underlying_cause_tag: null,
  };
};

// ─────────────────────────── failure-report taggers ───────────────────────────

/** session_list_failed report: surface the reported cause; record the
 *  originating live state for observability. */
export const tagListFailed = ({ event }: ActionArgs) => ({
  underlying_cause_tag:
    event.type === "session_list_failed"
      ? event.cause
      : ("list_sessions_degraded" as const),
  last_live_state: "awaiting_session_list_report" as const,
});

/** session_resume_failed report: surface the reported cause. */
export const tagResumeFailed = ({ event }: ActionArgs) => ({
  underlying_cause_tag:
    event.type === "session_resume_failed"
      ? event.cause
      : ("session_resume_failed" as const),
  last_live_state: "session_list_loaded" as const,
});

/** session_create_failed report: surface the reported cause; the welcome
 *  composer text stays in pending_first_message (preserved by the welcome
 *  capture; untouched here). */
export const tagCreateFailed = ({ event }: ActionArgs) => ({
  underlying_cause_tag:
    event.type === "session_create_failed"
      ? event.cause
      : ("session_create_failed" as const),
  last_live_state: "session_welcome" as const,
});

/** dataset_context_switch_failed report: surface the reported cause; the prior
 *  resource is left UNCHANGED (the report drives no resource write). */
export const tagSwitchFailed = ({ event }: ActionArgs) => ({
  underlying_cause_tag:
    event.type === "dataset_context_switch_failed"
      ? event.cause
      : ("dataset_context_switch_failed" as const),
  last_live_state: "session_active" as const,
  intended_resource_id: null,
  intended_resource_type: null,
});
