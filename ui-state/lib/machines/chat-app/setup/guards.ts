// Guard predicates for the ChatApp coordinator statechart.
//
// ROLE — guards are GATE CHECKS: pure `(context, event) => boolean` answering
// "may this transition fire?". They observe a child SNAPSHOT (read off the
// `onSnapshot` event, cast to the narrow view in ../setup/types.ts — those
// snapshot events are not members of ChatAppEvent) and decide whether the
// observed child state means a DOMAIN outcome (user ready, user rejected,
// project selected, project switch). Names are phrased in domain terms, not
// control-flow terms, so the statechart reads like a model of the user's
// journey rather than a model of which child slot fired which transition.
// They never mutate context (that is an action's job, ./actions.ts).
//
// The first-selection vs. project-switch split is discriminated WITHOUT a
// `stateIn` check, purely on context: `last_forwarded_project_id === null` means
// "not yet in chat" (advance), a different non-null id means "switch in place"
// (re-forward). This keeps the guards pure functions of (context, event).

import {
  onboardingSnapshot,
  projectContextSnapshot,
} from "./snapshot-readers.ts";
import type { GuardArgs } from "./types.ts";

/** The user is fully onboarded (identity verified, org resolved) → advance to
 *  project_context. */
const isUserReady = ({ event }: GuardArgs) =>
  onboardingSnapshot(event).value === "ready";

/** True when project-context has selected its FIRST project (none forwarded
 *  yet) — gates the project_context → chat advance. */
const isInitialProjectSelected = ({ context, event }: GuardArgs) =>
  projectContextSnapshot(event).value === "project_selected" &&
  context.last_forwarded_project_id === null;

/** True when project-context re-selected a DIFFERENT project than the one
 *  already forwarded — gates the in-place project-switch re-forward. A same-id
 *  snapshot is ignored (idempotent). */
const shouldSwitchProject = ({ context, event }: GuardArgs) => {
  const snapshot = projectContextSnapshot(event);
  return (
    snapshot.value === "project_selected" &&
    context.last_forwarded_project_id !== null &&
    snapshot.context.project.id !== context.last_forwarded_project_id
  );
};

// name → guard predicate index (keys referenced by string in ../machine.ts).
export const guards = {
  isUserReady,
  isInitialProjectSelected,
  shouldSwitchProject,
};
