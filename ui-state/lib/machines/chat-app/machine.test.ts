// Parent-only choreography tests for the ChatApp coordinator. These drive the
// parent via a created actor with FAKE children provided over the placeholder
// slots (the fakes are defined inline below — they are fixtures for THIS test
// only). No network, no Redis, no boundaries.
//
// The unique surface covered HERE (not redundantly with integration.test.ts):
//   - drivable parking of children at specific values (`verifying`,
//     `resolving`) so the parent can be held in any lifecycle phase;
//   - unknown events are no-ops (state-machine discipline).
//
// Coverage of the full forward cycle, hand-off payload contents, and
// PROJECT_SWITCH semantics lives in integration.test.ts against the real
// children. The two suites are complementary — choreography lives here,
// production-like behavior there.
//
// Children stay parent-ignorant: the test drives a child directly via its actor
// ref, and the parent only ever watches + forwards.

import { describe, expect, it } from "vitest";
import { type AnyActorRef, assign, createActor, setup } from "xstate";

import { createChatAppMachine } from "./machine.ts";
import type {
  ChatAppOnboardingLogic,
  ChatAppProjectContextLogic,
  ChatAppSessionChatLogic,
} from "./setup/actors.ts";
import type { ChatAppChildEvent, OnboardingInput } from "./setup/types.ts";

// ───────────────────────────── FAKE CHILDREN (test fixtures) ─────────────────
// Tiny, parent-ignorant stubs that expose JUST enough to drive the parent's
// choreography in isolation. Each fake:
//   - parks in a drivable state the parent watches via `onSnapshot`, so a test
//     can hold the parent in any lifecycle phase;
//   - RECORDS every event it receives in `context.rx`, so a test can assert
//     the parent forwarded — or DID NOT forward — a given intent.
//
// `record` is declared inside each fake's own `setup({ actions })` so XState
// infers it against that fake's context/event (a shared standalone action
// would be typed too narrowly to drop into a wider machine).

/** Anything a fake recorded — the parent forwards child events plus the test's
 *  drive events arrive here too; tests filter by `type`. */
type ReceivedEvent = { type: string } & Record<string, unknown>;

// Drivable onboarding: parks at `verifying`; DRIVE_READY advances to `ready`.
const fakeOnboarding = setup({
  types: {
    context: {} as {
      rx: ReceivedEvent[];
      org: { id: string | null };
      user: { first_name: string | null };
    },
    events: {} as
      | ChatAppChildEvent
      | { type: "DRIVE_READY"; org_id: string; first_name: string },
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
        "*": { actions: "record" },
      },
    },
    ready: { on: { "*": { actions: "record" } } },
  },
});

// Drivable project-context: parks at `resolving` once auth_ready arrives.
const fakeProjectContext = setup({
  types: {
    context: {} as {
      rx: ReceivedEvent[];
      project: { id: string | null; name: string | null };
    },
    events: {} as ChatAppChildEvent,
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
    resolving: { on: { "*": { actions: "record" } } },
  },
});

// Inert session-chat — never reached by the retained tests (none drive to the
// chat lifecycle phase), but the parent's `setup({ actors })` still needs a
// concrete logic for the slot.
const fakeSessionChat = setup({
  types: { events: {} as ChatAppChildEvent },
}).createMachine({
  id: "fake-session-chat",
  initial: "idle",
  states: { idle: {} },
});

/**
 * Build a ChatApp machine with the fakes provided over the placeholder
 * children. The casts bridge XState's invariant `provide` typing per slot;
 * they are runtime no-ops — the parent reads child readiness through the
 * onSnapshot snapshot views, not these types.
 */
function createChatAppWithFakes() {
  return createChatAppMachine().provide({
    actors: {
      onboarding: fakeOnboarding as unknown as ChatAppOnboardingLogic,
      projectContext: fakeProjectContext as unknown as ChatAppProjectContextLogic,
      sessionChat: fakeSessionChat as unknown as ChatAppSessionChatLogic,
    },
  });
}

/** Convenience default input for tests. The fakes ignore the begin envelope
 *  (no real I/O), but `principal_id` is a required member of OnboardingInput. */
const TEST_INPUT: OnboardingInput = {
  request_id: "req-chat-app-test",
  principal_id: "dev-user-001",
};

type ChatApp = ReturnType<typeof startChatApp>;

function startChatApp() {
  return createActor(createChatAppWithFakes(), { input: TEST_INPUT }).start();
}

// ── reading the parent's lifecycle value (now a single region, read directly) ──
function lifecycle(actor: ChatApp): unknown {
  return actor.getSnapshot().value;
}

// ── reaching into the invoked fakes (typed as placeholders at the parent, so
//    cast to read the fakes' recorded inbox) ──
function childRef(actor: ChatApp, id: string): AnyActorRef {
  return (actor.getSnapshot().children as Record<string, AnyActorRef>)[id];
}
function childRx(actor: ChatApp, id: string): ReceivedEvent[] {
  const snapshot = childRef(actor, id)?.getSnapshot() as
    | { context?: { rx?: ReceivedEvent[] } }
    | undefined;
  return snapshot?.context?.rx ?? [];
}

describe("ChatApp — starts in the login phase", () => {
  it("bootstraps into login with the onboarding child invoked", () => {
    const actor = startChatApp();
    expect(lifecycle(actor)).toBe("login");
    expect(childRef(actor, "onboarding")).toBeDefined();
  });
});

describe("ChatApp — unknown events are ignored", () => {
  it("leaves the lifecycle value unchanged and forwards nothing", () => {
    const actor = startChatApp();
    const before = actor.getSnapshot().value;
    const onboardingRxBefore = childRx(actor, "onboarding").length;

    // An event the machine declares nowhere.
    actor.send({ type: "totally_unknown_event" } as never);

    expect(actor.getSnapshot().value).toEqual(before);
    expect(childRx(actor, "onboarding").length).toBe(
      onboardingRxBefore,
    );
  });
});
