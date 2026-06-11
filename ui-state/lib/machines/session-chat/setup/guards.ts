// Guard predicates for the session-chat statechart (REPORT-DRIVEN).
//
// ROLE — guards are GATE CHECKS on state transitions: pure
// `(context, event) => boolean` predicates answering "may this transition
// fire?". Under the report-driven model (ADR-050 §e.5 / DR-8/AR-8) the machine
// invokes no actors, so the old `onDone`/`onError` predicates that read
// `event.output` (hasResumeTarget / isSessionNotFound / isDatasetAccessDenied)
// and the retry-routing guards (wasLoadingList / wasResuming / wasWelcome /
// wasSwitchingDataset) are RETIRED with the invokes they gated. What survives
// are the two event-payload predicates the surviving UI intents need.
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

/** project_ready re-broadcast: the orchestrator targets a DIFFERENT project than
 *  the one currently held — invalidate + reload. Same project_id is an
 *  idempotent no-op (the missing branch). Used by session_list_loaded,
 *  session_active and session_welcome. */
const isDifferentProject = ({ context, event }: GuardArgs) =>
  event.type === "project_ready" && context.project?.id !== event.project_id;

// name → guard predicate index (keys referenced by string in ../machine.ts).
export const guards = {
  isStaleSessionClick,
  isDifferentProject,
};
