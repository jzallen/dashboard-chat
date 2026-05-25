// Logical child actors for the ChatApp coordinator — the DEPENDENCY-INJECTION
// seam (ADR-044, Phase 1).
//
// ChatApp declares three logical children in `setup({ actors })`:
//   - onboarding      (systemId "session-onboarding")
//   - projectContext  (systemId "project-context")
//   - sessionChat     (systemId "session-chat")
//
// The implementations here are minimal PLACEHOLDERS. They establish the logical
// actor identity + the event surface the parent statically `sendTo`s (the
// ChatAppChildEvent union), and they are ALWAYS overridden via
// `machine.provide({ actors })`:
//   - Phase 1 provides FAKE children (test scope — ./fakes.ts) to drive the
//     parent's choreography in isolation.
//   - Phase 2 provides the REAL session-onboarding / project-context /
//     session-chat machines.
//
// Because XState's `provide` is type-invariant in a child's context, the
// override site casts the swapped machine to the placeholder's actor logic type
// (a localized, runtime-noop cast — see ./fakes.ts). The placeholders therefore
// need only accept the forwarded-event union; the parent reads child READINESS
// through `onSnapshot` snapshot views (../setup/types.ts), never through these
// placeholder types.

import { setup } from "xstate";

import type { ChatAppChildEvent, ChatAppChildInput } from "./types.ts";

/** A do-nothing child. It accepts (and ignores) every event the parent may
 *  forward, never leaves `idle`, and declares the `ChatAppChildInput` superset
 *  as its input type so the parent's three `invoke.input` mappers (machine.ts)
 *  type-check against this slot (the placeholder is swapped for the real machine
 *  via `.provide({ actors })`). Never used in tests or production — always
 *  provided over. */
function createPlaceholderChild() {
  return setup({
    types: {
      events: {} as ChatAppChildEvent,
      input: {} as ChatAppChildInput,
    },
  }).createMachine({
    id: "chat-app-child-placeholder",
    initial: "idle",
    states: { idle: {} },
  });
}

/** The three logical children threaded into `setup({ actors })`. Distinct
 *  instances keep each `invoke.src` independently typed. */
export const actors = {
  onboarding: createPlaceholderChild(),
  projectContext: createPlaceholderChild(),
  sessionChat: createPlaceholderChild(),
};

/** The actor-logic type of a child slot — the cast target a caller uses when
 *  providing a concrete (fake or real) child over a placeholder. */
export type ChatAppChildLogic = (typeof actors)["onboarding"];
