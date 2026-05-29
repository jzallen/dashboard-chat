// Actions for the session-chat statechart — the ONLY writers of machine context.
// Each is a bare closure, param-annotated with the shared `ActionArgs` alias
// (./types.ts); the `assign(...)` wrap happens at the `setup()` call in
// ../machine.ts, where inference flows from `setup`'s `types` — no xstate
// generics are pinned here.
//
// `event` is the FULL declared event union for EVERY action: `setup` types each
// named action's expression-event as the whole `TEvent`, regardless of which
// transition references it. Events that carry a specific payload narrow on
// `event.type`; done events from invoked actors are NOT members, so the
// actor-result readers cast `event` to reach `.output`.
//
// project_ready reset variants (the per-state divergence is deliberate — see the
// state-by-state field table in ../README.md): the four switch states share
// `resetForProjectSwitch` (identity + session-state reset); the two states that
// carry a deep-link resume wish compose `+captureDeeplinkResume`; the welcome
// state composes `+clearPendingFirstMessage`; the cold-arrival
// `waiting_for_project` uses `applyProjectReady` (identity + resume wish, NO
// session reset). Composing fine-grained assigns keeps each writer's field set
// explicit — no state silently gains or drops a reset.

import type {
  ActionArgs,
  ResourceType,
  SessionSummary,
  TranscriptMessage,
} from "./types.ts";
import type { LoadSessionListOutput } from "./actors.ts";

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
 *  resource, session_list) BEFORE the new project's loading_session_list fires.
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

/** Composed onto the project switch for `loading_session_list` and
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
 *  target the `resuming_session` invoke reads from ctx. */
export const capturePendingResumeIntent = ({ event, context }: ActionArgs) => ({
  pending_resume_session_id:
    event.type === "session_clicked"
      ? event.session_id
      : context.pending_resume_session_id,
});

/** first_message_sent: preserve the composer text across
 *  session_welcome ↔ error_recoverable. */
export const capturePendingFirstMessage = ({ event, context }: ActionArgs) => ({
  pending_first_message:
    event.type === "first_message_sent"
      ? event.content
      : context.pending_first_message,
});

/** DWD-7 — a session_clicked whose target no longer resolves in the post-THAW
 *  state is silent-dropped (observability only, no UX surface). The count +
 *  last_stale_intent are harvested by the orchestrator to emit
 *  `stale_intent_dropped_after_thaw`. */
export const recordStaleSessionClicked = ({ event, context }: ActionArgs) => ({
  stale_intents_dropped_count: context.stale_intents_dropped_count + 1,
  last_stale_intent: {
    intent_type: "session_clicked",
    target_id: event.type === "session_clicked" ? event.session_id : "",
  },
});

/** US-209 — capture the dataset pick from `dataset_resolved_by_agent` /
 *  `dataset_picked_directly` so the `switching_dataset_context` invoke can read
 *  it from ctx (XState invoke input reads context, not the triggering event). */
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

// ─────────────────────────── session list settle ───────────────────────────

/** loadSessionList onDone (both branches): land the loaded session list. Shared
 *  body — the resume branch and the plain branch assign the same three fields. */
export const assignSessionList = ({ event }: ActionArgs) => {
  const out = (event as unknown as { output: LoadSessionListOutput }).output;
  return {
    session_list: out.items,
    session_list_next_cursor: out.next_cursor,
    session_list_has_more: out.has_more,
  };
};

/** new_session_clicked from session_list_loaded (US-206 / DWD-10 lazy-creation):
 *  enter the welcome state with session_id null; no backend write fires until
 *  first_message_sent. */
export const enterWelcomeReset = () => ({
  session_id: null,
  transcript: [] as TranscriptMessage[],
  resource: { type: null, id: null } as {
    type: ResourceType | null;
    id: string | null;
  },
  pending_first_message: "",
});

// ─────────────────────────── resume settle ───────────────────────────

/** resumeSession onDone (session_not_found): silent return per US-205 Example 4
 *  — clear the pending resume target so we don't loop on re-emission. */
export const clearResumeTarget = () => ({
  pending_resume_session_id: null,
  session_id: null,
  transcript: [] as TranscriptMessage[],
  resource: { type: null, id: null } as {
    type: ResourceType | null;
    id: string | null;
  },
  underlying_cause_tag: null,
});

/** resumeSession onDone (active): atomic materialization per IC-J002-3 —
 *  transcript AND resource are populated in a SINGLE assign before transitioning
 *  to session_active. There is no intermediate snapshot where one is set but not
 *  the other. DO NOT split into multiple actions. */
export const assignResumedSession = ({ event }: ActionArgs) => {
  const out = (
    event as unknown as {
      output: {
        session_id: string;
        transcript: TranscriptMessage[];
        active_dataset_id: string | null;
        dataset_unavailable?: boolean;
      };
    }
  ).output;
  const resource: { type: ResourceType | null; id: string | null } =
    out.dataset_unavailable === true || out.active_dataset_id === null
      ? { type: null, id: null }
      : { type: "dataset" as ResourceType, id: out.active_dataset_id };
  return {
    session_id: out.session_id,
    transcript: out.transcript,
    resource,
    underlying_cause_tag:
      out.dataset_unavailable === true
        ? ("dataset_not_found" as const)
        : null,
    pending_resume_session_id: null,
  };
};

// ─────────────────────────── dataset switch settle ───────────────────────────

/** switchDatasetContext onDone (dataset_access_denied): leave `context.resource`
 *  UNCHANGED, surface the named cause for the FE gutter copy, and clear the pick
 *  (US-209 Example 3/4 — prior scope preserved). */
export const tagDatasetDeniedClearPick = () => ({
  underlying_cause_tag: "dataset_access_denied" as const,
  intended_resource_id: null,
  intended_resource_type: null,
});

/** switchDatasetContext onDone (validated + persisted): retarget
 *  `context.resource` to the picked dataset. Single atomic assign — there is no
 *  intermediate snapshot where resource is half-updated (IC-J002-5: exactly ONE
 *  resource_* update). */
export const assignSwitchedDataset = ({ event }: ActionArgs) => {
  const out = (
    event as unknown as { output: { resource_type: ResourceType; resource_id: string } }
  ).output;
  return {
    resource: { type: out.resource_type, id: out.resource_id },
    underlying_cause_tag: null,
    intended_resource_id: null,
    intended_resource_type: null,
  };
};

// ─────────────────────────── eager-create settle ───────────────────────────

/** createSessionEagerly onDone: land the created session id; the transcript +
 *  resource start empty (the welcome composer's first message becomes the first
 *  turn once chat begins). */
export const assignCreatedSession = ({ event }: ActionArgs) => {
  const out = (event as unknown as { output: { session_id: string } }).output;
  return {
    session_id: out.session_id,
    transcript: [] as TranscriptMessage[],
    resource: { type: null, id: null } as {
      type: ResourceType | null;
      id: string | null;
    },
    pending_first_message: "",
    underlying_cause_tag: null,
  };
};

// ─────────────────────────── cause tags (onError) ───────────────────────────

/** loadSessionList onError: degraded session-list read. */
export const tagListDegraded = () => ({
  underlying_cause_tag: "list_sessions_degraded" as const,
  last_live_state: "loading_session_list" as const,
});

/** resumeSession onError: transient failure resuming a session. */
export const tagTransientResuming = () => ({
  underlying_cause_tag: "transient" as const,
  last_live_state: "resuming_session" as const,
});

/** switchDatasetContext onError: transient failure switching the dataset. */
export const tagTransientSwitching = () => ({
  underlying_cause_tag: "transient" as const,
  last_live_state: "switching_dataset_context" as const,
});

/** createSessionEagerly onError: transient failure creating the session — the
 *  retry returns to session_welcome with pending_first_message intact. */
export const tagTransientCreating = () => ({
  underlying_cause_tag: "transient" as const,
  last_live_state: "session_welcome" as const,
});

// ─────────────────────────── retry ───────────────────────────

/** error_recoverable retry (all four branches): clear the transient cause and
 *  bump the retry counter. The branch's guard picks the target live state;
 *  pending_first_message / the captured dataset pick are preserved untouched. */
export const clearErrorAndBumpRetries = ({ context }: ActionArgs) => ({
  underlying_cause_tag: null,
  retries_count: context.retries_count + 1,
});
