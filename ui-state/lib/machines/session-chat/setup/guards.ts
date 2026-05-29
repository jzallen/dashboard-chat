// Guard predicates for the session-chat statechart.
//
// ROLE — guards are GATE CHECKS on state transitions: pure
// `(context, event) => boolean` predicates answering "may this transition
// fire?". The `onDone` predicates read the actor result off `event.output` (a
// done event is not a member of `SessionChatEvent`, so they cast `event` to
// reach `.output`, exactly as they did when inline). The event-payload
// predicates narrow on `event.type` to reach the variant's fields.
//
// Defined in this bundle so machine.ts reads as transitions. Each predicate
// annotates its arg with `GuardArgs` and is exported as one `guards` bundle the
// machine threads into `setup({ guards })`.

import type { GuardArgs } from "./types.ts";

/** True when a session_clicked targets a session absent from the current
 *  session_list — a stale/replayed click (e.g. post-THAW muscle-memory after
 *  the user switched projects during freeze). Silent-dropped via
 *  recordStaleSessionClicked (observability only); no transition. */
const isStaleSessionClick = ({ context, event }: GuardArgs) =>
  event.type === "session_clicked" &&
  !context.session_list.some((s) => s.id === event.session_id);

/** loadSessionList onDone: a deep-link continuation surfaces the forwarded
 *  resume target via `event.output.resume_target` (LEAF-C / Direction F). */
const hasResumeTarget = ({ event }: GuardArgs) =>
  (event as { output?: { resume_target?: string | null } }).output
    ?.resume_target != null;

/** resumeSession onDone: the session was deleted between list + resume — a
 *  silent return to session_list_loaded per US-205 Example 4. */
const isSessionNotFound = ({ event }: GuardArgs) =>
  (event as { output?: { session_not_found?: true } }).output?.session_not_found ===
  true;

/** project_ready re-broadcast: the orchestrator targets a DIFFERENT project than
 *  the one currently held — invalidate + reload. Same project_id is an
 *  idempotent no-op (the missing branch). Used by session_list_loaded,
 *  session_active and session_welcome. */
const isDifferentProject = ({ context, event }: GuardArgs) =>
  event.type === "project_ready" && context.project?.id !== event.project_id;

/** switchDatasetContext onDone: ScopeResolver invariant 4 rejection (403 / 404 /
 *  cross-project) — leave `context.resource` unchanged. */
const isDatasetAccessDenied = ({ event }: GuardArgs) =>
  (event as { output?: { dataset_access_denied?: true } }).output
    ?.dataset_access_denied === true;

// error_recoverable retry routing — pick the live state the failure came from.
// `last_live_state` is a wire-frozen state value; these compare it verbatim.
const wasLoadingList = ({ context }: GuardArgs) =>
  context.last_live_state === "loading_session_list";
const wasResuming = ({ context }: GuardArgs) =>
  context.last_live_state === "resuming_session";
const wasWelcome = ({ context }: GuardArgs) =>
  context.last_live_state === "session_welcome";
const wasSwitchingDataset = ({ context }: GuardArgs) =>
  context.last_live_state === "switching_dataset_context";

// name → guard predicate index (keys referenced by string in ../machine.ts).
export const guards = {
  isStaleSessionClick,
  hasResumeTarget,
  isSessionNotFound,
  isDifferentProject,
  isDatasetAccessDenied,
  wasLoadingList,
  wasResuming,
  wasWelcome,
  wasSwitchingDataset,
};
