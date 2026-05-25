// Guard predicates for the ChatApp coordinator statechart.
//
// ROLE — guards are GATE CHECKS: pure `(context, event) => boolean` answering
// "may this transition fire?". The child-watching guards read the forwarded
// child SNAPSHOT off the `onSnapshot` event (cast to the narrow view in
// ../setup/types.ts — the snapshot events are not members of ChatAppEvent), and
// route on the child's state value / project identity. They never mutate
// context (that is an action's job, ./actions.ts).
//
// The first-selection vs. project-switch split is discriminated WITHOUT a
// `stateIn` check, purely on context: `last_forwarded_project_id === null` means
// "not yet in chat" (advance), a different non-null id means "switch in place"
// (re-forward). This keeps the guards pure functions of (context, event).

import type {
  GuardArgs,
  OnboardingSnapshotView,
  ProjectContextSnapshotView,
} from "./types.ts";

/** Read the onboarding child's snapshot off an onSnapshot event. */
function onboardingSnapshot(event: GuardArgs["event"]): OnboardingSnapshotView {
  return (event as unknown as { snapshot: OnboardingSnapshotView }).snapshot;
}

/** Read the project-context child's snapshot off an onSnapshot event. */
function projectContextSnapshot(
  event: GuardArgs["event"],
): ProjectContextSnapshotView {
  return (event as unknown as { snapshot: ProjectContextSnapshotView })
    .snapshot;
}

export const guards = {
  /** Onboarding child resolved an org + identity → advance to project_context. */
  childReachedReady: ({ event }: GuardArgs) =>
    onboardingSnapshot(event).value === "ready",

  /** Onboarding re-verify failed → terminal rejected. */
  childReachedSessionRejected: ({ event }: GuardArgs) =>
    onboardingSnapshot(event).value === "session_rejected",

  /** Project-context selected its FIRST project (we have not forwarded one yet)
   *  → advance project_context → chat. */
  advanceToChat: ({ context, event }: GuardArgs) =>
    projectContextSnapshot(event).value === "project_selected" &&
    context.last_forwarded_project_id === null,

  /** Project-context re-entered project_selected with a DIFFERENT project than
   *  the one already forwarded → re-forward project_ready to session-chat in
   *  place (the project-switch path). A same-id snapshot is ignored (idempotent). */
  reforwardProjectReady: ({ context, event }: GuardArgs) => {
    const snapshot = projectContextSnapshot(event);
    return (
      snapshot.value === "project_selected" &&
      context.last_forwarded_project_id !== null &&
      snapshot.context.project.id !== context.last_forwarded_project_id
    );
  },
};
