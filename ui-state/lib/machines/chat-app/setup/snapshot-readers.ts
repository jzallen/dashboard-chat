// Shared snapshot readers for the ChatApp coordinator statechart.
//
// The parent watches its children via `onSnapshot`; the snapshot events are NOT
// members of `ChatAppEvent` (../setup/types.ts), so both the guards (./guards.ts)
// and the context-writer actions (./actions.ts) must read the child snapshot off
// the event through the narrow views in ../setup/types.ts — the same cast
// convention the guards and the child machines use. These readers were defined
// TWICE (inline in machine.ts and again in guards.ts); they live here once so
// both consumers import the single definition (RPP L2 — DRY).

import type {
  ChatAppEvent,
  OnboardingSnapshotView,
  ProjectContextSnapshotView,
} from "./types.ts";

/** Read the onboarding child's snapshot off an onSnapshot event. */
export function onboardingSnapshot(
  event: ChatAppEvent,
): OnboardingSnapshotView {
  return (event as unknown as { snapshot: OnboardingSnapshotView }).snapshot;
}

/** Read the project-context child's snapshot off an onSnapshot event. */
export function projectContextSnapshot(
  event: ChatAppEvent,
): ProjectContextSnapshotView {
  return (event as unknown as { snapshot: ProjectContextSnapshotView })
    .snapshot;
}
