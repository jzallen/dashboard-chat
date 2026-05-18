// `waitForSettledState` — pump/strategy shared helper.
//
// Extracted from `orchestrator.ts` in ADR-040 LEAF-3 MR-L3a/N2 so the
// carved `LoginOrgSetupStrategy` can await actor settling WITHOUT a runtime
// import edge back into `orchestrator.ts` (strategy → orchestrator stays
// TYPE-ONLY, erased at runtime → no circular-init hazard regardless of
// module entry order). Behavior-neutral: byte-identical function body,
// new home; `orchestrator.ts` imports it for its existing internal callers.

import type { AnyActorRef } from "xstate";

/**
 * Wait for the XState actor to leave any transient state (i.e., to settle
 * out of an `invoke`'d promise). Subscribes once, resolves on the first
 * snapshot whose value is one of the terminal-for-now states.
 *
 * For the walking skeleton: authenticating is transient; everything else is
 * settled. Later steps that introduce more invoke-driven states extend this
 * to a state-machine-aware predicate.
 */
export function waitForSettledState(
  actor: AnyActorRef,
  timeoutMs = 10000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // States that contain `invoke` blocks — caller waits for them to leave.
    // J-001: authenticating, creating_org. J-002 project-context:
    // resolving_initial_scope, creating_project, switching_project (MR-4 —
    // the `switchProject` invoke; D-MR4-06: this was previously missing, so
    // `send()` did not await the switch and the projection never settled).
    // J-002 session-chat: loading_session_list, resuming_session,
    // switching_dataset_context (MR-5 — the `switchDatasetContext` invoke;
    // GET /api/datasets/:id + PATCH session.active_dataset_id. Mirrors the
    // D-MR4-06 fix for switching_project: omitting it here would make
    // `send()` NOT await the invoke, so the projection would stay stuck at
    // switching_dataset_context and the resource_* update never settle).
    const TRANSIENT_STATES = new Set([
      "authenticating",
      "creating_org",
      "resolving_initial_scope",
      "creating_project",
      "switching_project",
      "loading_session_list",
      "resuming_session",
      "creating_session",
      "switching_dataset_context",
    ]);
    const snapshot = actor.getSnapshot();
    if (!TRANSIENT_STATES.has(snapshot.value as string)) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error("waitForSettledState: timeout"));
    }, timeoutMs);

    const sub = actor.subscribe((snap) => {
      if (!TRANSIENT_STATES.has(snap.value as string)) {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve();
      }
    });
  });
}
