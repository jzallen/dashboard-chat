// FAKE child machines for ChatApp Phase-1 statechart tests (TEST SCOPE ONLY).
//
// These are tiny, parent-ignorant stubs that expose JUST enough to drive the
// parent's choreography in isolation — no network, no Redis, no real WorkOS.
// Each one:
//   - reaches the readiness state the parent watches via `onSnapshot`
//     (onboarding → `ready`, project-context → `project_selected`,
//     session-chat → `session_active`),
//   - RECORDS every event it receives in `context.rx`, so a test can assert the
//     parent forwarded the right hand-off / intent to the right child.
//
// They are deliberately DRIVABLE (explicit `DRIVE_*` events) rather than
// auto-advancing, so a test can park the machine in any lifecycle phase to prove
// the connectivity (freeze) region is orthogonal to it. Phase 2 swaps these for
// the real machines via the same `.provide({ actors })` seam.
//
// `record` is declared inside each fake's own `setup({ actions })` so XState
// infers it against that fake's context/event (a shared standalone action would
// be typed too narrowly to drop into a wider machine).

import { assign, setup } from "xstate";

import { createChatAppMachine } from "./machine.ts";
import type { ChatAppChildLogic } from "./setup/actors.ts";
import type { ChatAppChildEvent, ChatAppInput } from "./setup/types.ts";

/** Anything a fake recorded — the parent forwards child events plus the test's
 *  drive events arrive here too; tests filter by `type`. */
export type ReceivedEvent = { type: string } & Record<string, unknown>;

// ───────────────────────────── fake onboarding ─────────────────────────────
// verifying ─(DRIVE_READY)─► ready          (carries org_id + first_name)
//           └(DRIVE_REJECTED)─► session_rejected
export const fakeOnboarding = setup({
  types: {
    context: {} as {
      rx: ReceivedEvent[];
      org: { id: string | null };
      user: { first_name: string | null };
    },
    events: {} as
      | ChatAppChildEvent
      | { type: "DRIVE_READY"; org_id: string; first_name: string }
      | { type: "DRIVE_REJECTED" },
  },
  actions: {
    record: assign({
      rx: ({ context, event }) => [...context.rx, event as ReceivedEvent],
    }),
  },
}).createMachine({
  id: "fake-onboarding",
  initial: "verifying",
  context: { rx: [], org: { id: null }, user: { first_name: null } },
  states: {
    verifying: {
      on: {
        DRIVE_READY: {
          target: "ready",
          actions: [
            "record",
            assign({
              org: ({ event }) => ({ id: event.org_id }),
              user: ({ event }) => ({ first_name: event.first_name }),
            }),
          ],
        },
        DRIVE_REJECTED: { target: "session_rejected", actions: "record" },
        "*": { actions: "record" },
      },
    },
    ready: { on: { "*": { actions: "record" } } },
    session_rejected: {},
  },
});

// ──────────────────────────── fake project-context ────────────────────────────
// waiting_for_auth ─(auth_ready)─► resolving ─(DRIVE_SELECT)─► project_selected
//                  project_selected ─(switching_project_intent)─► project_selected'
export const fakeProjectContext = setup({
  types: {
    context: {} as {
      rx: ReceivedEvent[];
      project: { id: string | null; name: string | null };
    },
    events: {} as
      | ChatAppChildEvent
      | { type: "DRIVE_SELECT"; project_id: string; project_name: string },
  },
  actions: {
    record: assign({
      rx: ({ context, event }) => [...context.rx, event as ReceivedEvent],
    }),
  },
}).createMachine({
  id: "fake-project-context",
  initial: "waiting_for_auth",
  context: { rx: [], project: { id: null, name: null } },
  states: {
    waiting_for_auth: {
      on: {
        auth_ready: { target: "resolving", actions: "record" },
        "*": { actions: "record" },
      },
    },
    resolving: {
      on: {
        DRIVE_SELECT: {
          target: "project_selected",
          actions: [
            "record",
            assign({
              project: ({ event }) => ({
                id: event.project_id,
                name: event.project_name,
              }),
            }),
          ],
        },
        "*": { actions: "record" },
      },
    },
    project_selected: {
      on: {
        switching_project_intent: {
          target: "project_selected",
          reenter: true,
          actions: [
            "record",
            assign({
              project: ({ event }) => ({
                id: event.new_project_id,
                name: `Project ${event.new_project_id}`,
              }),
            }),
          ],
        },
        "*": { actions: "record" },
      },
    },
  },
});

// ───────────────────────────── fake session-chat ─────────────────────────────
// waiting_for_project ─(project_ready)─► session_active   (records all intents)
export const fakeSessionChat = setup({
  types: {
    context: {} as { rx: ReceivedEvent[] },
    events: {} as ChatAppChildEvent,
  },
  actions: {
    record: assign({
      rx: ({ context, event }) => [...context.rx, event as ReceivedEvent],
    }),
  },
}).createMachine({
  id: "fake-session-chat",
  initial: "waiting_for_project",
  context: { rx: [] },
  states: {
    waiting_for_project: {
      on: {
        project_ready: { target: "session_active", actions: "record" },
        "*": { actions: "record" },
      },
    },
    // Records re-forwarded project_ready (switch) AND user intents.
    session_active: { on: { "*": { actions: "record" } } },
  },
});

/**
 * Build a ChatApp machine with the fakes provided over the placeholder children.
 * The casts bridge XState's invariant `provide` typing (the fakes are
 * structurally wider than the placeholders); they are runtime no-ops — the
 * parent reads child readiness through the onSnapshot snapshot views, not these
 * types.
 */
export function createChatAppWithFakes() {
  return createChatAppMachine().provide({
    actors: {
      onboarding: fakeOnboarding as unknown as ChatAppChildLogic,
      projectContext: fakeProjectContext as unknown as ChatAppChildLogic,
      sessionChat: fakeSessionChat as unknown as ChatAppChildLogic,
    },
  });
}

/** Convenience default input for tests. The fakes ignore the begin envelope
 *  (no real I/O), but `principal_id` is now a required member of ChatAppInput. */
export const TEST_INPUT: ChatAppInput = {
  request_id: "req-chat-app-test",
  principal_id: "dev-user-001",
};
