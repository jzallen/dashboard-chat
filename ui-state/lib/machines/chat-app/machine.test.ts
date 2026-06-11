// Parent-only choreography tests for the ChatApp coordinator. These drive the
// parent via a created actor with FAKE children provided over the placeholder
// slots (the fakes are defined inline below — they are fixtures for THIS test
// only). No network, no Redis, no boundaries.
//
// The unique surface covered HERE (CDO-S3 / 03-04, phase-gated vocabulary
// routing — ADR-049 §4 / domain-model §6 Option 1):
//   - the DWD-5 DETERMINISTIC CRASH REPRODUCTION: an onboarding-vocabulary event
//     posted while the parent is `engaged` (the onboarding child stopped) is
//     DROPPED — no transition, the settled snapshot survives, the process stays
//     alive, and a SUBSEQUENT in-phase event still processes (LIVENESS). On the
//     pre-03-04 machine the root total forward sent into the stopped child via
//     `active_child_id` and the actor died; the phase-gated machine makes that
//     unrepresentable (no handler in `engaged` for onboarding vocab);
//   - phase-gated routing: onboarding vocab routes only on `login`;
//     project-context vocab routes on `engaged` (incl. from chat); session vocab
//     routes on `engaged.chat`; an out-of-phase KNOWN event converges (no-op);
//   - unknown events are no-ops (state-machine discipline).
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
//     the parent forwarded — or DID NOT forward — a given event.
//
// `record` is declared inside each fake's own `setup({ actions })` so XState
// infers it against that fake's context/event (a shared standalone action
// would be typed too narrowly to drop into a wider machine).

/** Anything a fake recorded — the parent forwards child events plus the test's
 *  drive events arrive here too; tests filter by `type`. */
type ReceivedEvent = { type: string } & Record<string, unknown>;

// Drivable onboarding: parks at `verifying`; on `org_found` (a forwarded raw
// onboarding-vocabulary event) advances to `ready` so the parent's isUserReady
// onSnapshot fires and the parent advances to engaged.
const fakeOnboarding = setup({
  types: {
    context: {} as {
      rx: ReceivedEvent[];
      org: { id: string | null; name: string | null };
      user: { first_name: string | null };
    },
    events: {} as
      | ChatAppChildEvent
      | { type: "org_found"; org: { id: string; name: string } },
  },
  actions: {
    record: assign({
      rx: ({ context, event }) => [...context.rx, event as ReceivedEvent],
    }),
  },
}).createMachine({
  id: "fake-onboarding",
  initial: "verifying",
  context: {
    rx: [],
    org: { id: null, name: null },
    user: { first_name: "Maya" },
  },
  states: {
    verifying: {
      on: {
        org_found: {
          target: "ready",
          actions: [
            "record",
            assign({
              org: ({ event }) => ({ id: event.org.id, name: event.org.name }),
            }),
          ],
        },
        "*": { actions: "record" },
      },
    },
    // `ready` is the value the parent's isUserReady guard reads off the snapshot.
    ready: { on: { "*": { actions: "record" } } },
  },
});

// Drivable project-context: parks at `awaiting_scope_report` once auth_ready
// arrives; on `scope_resolved` settles `project_selected` so the parent's
// isInitialProjectSelected onSnapshot advances to engaged.chat.
const fakeProjectContext = setup({
  types: {
    context: {} as {
      rx: ReceivedEvent[];
      project: { id: string | null; name: string | null };
    },
    events: {} as
      | ChatAppChildEvent
      | { type: "scope_resolved"; project: { id: string; name: string } }
      | { type: "project_switched"; project: { id: string; name: string } },
  },
  actions: {
    record: assign({
      rx: ({ context, event }) => [...context.rx, event as ReceivedEvent],
    }),
    landProject: assign({
      project: ({ event }) =>
        (event as { project: { id: string; name: string } }).project,
    }),
  },
}).createMachine({
  id: "fake-project-context",
  initial: "waiting_for_auth",
  context: { rx: [], project: { id: null, name: null } },
  states: {
    waiting_for_auth: {
      on: {
        auth_ready: { target: "awaiting_scope_report", actions: "record" },
        "*": { actions: "record" },
      },
    },
    awaiting_scope_report: {
      on: {
        scope_resolved: {
          target: "project_selected",
          actions: ["record", "landProject"],
        },
        "*": { actions: "record" },
      },
    },
    project_selected: {
      on: {
        // A report-only switch re-lands a DIFFERENT project (re-enter so the
        // parent's shouldSwitchProject onSnapshot re-fires on the changed id).
        project_switched: {
          target: "project_selected",
          reenter: true,
          actions: ["record", "landProject"],
        },
        "*": { actions: "record" },
      },
    },
  },
});

// Drivable session-chat: parks at `session_list_loaded`; records every event the
// parent forwards (session vocabulary) so a chat-phase routing test can assert it.
const fakeSessionChat = setup({
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
  initial: "session_list_loaded",
  context: { rx: [] },
  states: {
    session_list_loaded: { on: { "*": { actions: "record" } } },
  },
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
function childRef(actor: ChatApp, id: string): AnyActorRef | undefined {
  return (actor.getSnapshot().children as Record<string, AnyActorRef>)[id];
}
function childRx(actor: ChatApp, id: string): ReceivedEvent[] {
  const snapshot = childRef(actor, id)?.getSnapshot() as
    | { context?: { rx?: ReceivedEvent[] } }
    | undefined;
  return snapshot?.context?.rx ?? [];
}

/** Drive the parent login → engaged.project_context → engaged.chat via the raw
 *  phase-gated vocabulary the parent now routes directly (no child_event). */
function driveToChat(actor: ChatApp): void {
  actor.send({ type: "org_found", org: { id: "org-1", name: "Acme Data" } });
  // Now engaged.project_context. Report the resolved scope.
  actor.send({ type: "scope_resolved", project: { id: "proj-A", name: "Project A" } });
  // Now engaged.chat.
}

describe("ChatApp — starts in the login phase", () => {
  it("bootstraps into login with the onboarding child invoked", () => {
    const actor = startChatApp();
    expect(lifecycle(actor)).toBe("login");
    expect(childRef(actor, "onboarding")).toBeDefined();
  });
});

describe("ChatApp — phase-gated onboarding vocabulary (login only)", () => {
  it("forwards org_found to the onboarding child while in login and advances to engaged", () => {
    const actor = startChatApp();
    actor.send({ type: "org_found", org: { id: "org-1", name: "Acme Data" } });

    // The onboarding child received the raw org_found and advanced to ready;
    // the parent's isUserReady onSnapshot advanced to engaged.project_context.
    // The advance to engaged IS the proof the forward reached onboarding: only a
    // child that received org_found, transitioned to `ready`, and emitted that
    // snapshot can trip the parent's isUserReady onSnapshot. (Its inbox is no
    // longer readable here — advancing to engaged STOPS the phase-scoped
    // onboarding invoke, so it has left the snapshot; the DWD-5 test below pins
    // that stop explicitly.)
    expect(lifecycle(actor)).toEqual({ engaged: "project_context" });
    expect(childRef(actor, "onboarding")).toBeUndefined();
  });
});

describe("ChatApp — phase-gated project-context vocabulary (engaged)", () => {
  it("forwards scope_resolved to project-context while engaged and advances to chat", () => {
    const actor = startChatApp();
    actor.send({ type: "org_found", org: { id: "org-1", name: "Acme Data" } });
    expect(lifecycle(actor)).toEqual({ engaged: "project_context" });

    actor.send({
      type: "scope_resolved",
      project: { id: "proj-A", name: "Project A" },
    });
    expect(lifecycle(actor)).toEqual({ engaged: "chat" });
    expect(
      childRx(actor, "project-context").some((e) => e.type === "scope_resolved"),
    ).toBe(true);
  });

  it("routes a project-context report (project_switched) even while chat is the active child", () => {
    const actor = startChatApp();
    driveToChat(actor);
    expect(lifecycle(actor)).toEqual({ engaged: "chat" });

    // project_switched is project-context vocabulary handled on `engaged` (NOT
    // engaged.project_context), so it reaches project-context FROM chat.
    actor.send({
      type: "project_switched",
      project: { id: "proj-B", name: "Project B" },
    });
    expect(
      childRx(actor, "project-context").some((e) => e.type === "project_switched"),
    ).toBe(true);
  });
});

describe("ChatApp — phase-gated session vocabulary (engaged.chat)", () => {
  it("forwards session_clicked to the session-chat child while in chat", () => {
    const actor = startChatApp();
    driveToChat(actor);
    expect(lifecycle(actor)).toEqual({ engaged: "chat" });

    actor.send({ type: "session_clicked", session_id: "s1" });
    expect(
      childRx(actor, "session-chat").some(
        (e) => e.type === "session_clicked" && e.session_id === "s1",
      ),
    ).toBe(true);
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
    expect(childRx(actor, "onboarding").length).toBe(onboardingRxBefore);
  });
});

// ═══════════════════ DWD-5 — deterministic crash reproduction (Spec 8) ═══════════════════
//
// THE regression lock for the 2026-06-10 settled-child process death. On the
// pre-03-04 machine, the root-level total forward `on: { user_intent, child_event }`
// sent every event to `context.active_child_id`; once the parent advanced past
// `login` the onboarding child was STOPPED, so an onboarding-vocabulary event
// arriving while engaged resolved `sendTo("onboarding")` into a stopped child →
// XState threw inside event processing → the bare actor (no error observer) died.
//
// The phase-gated machine makes this UNREPRESENTABLE: `engaged` declares NO
// handler for onboarding vocabulary, so XState DROPS the event (no sendTo runs,
// no throw can occur). The actor stays alive, the settled snapshot is unchanged,
// and a subsequent IN-PHASE event still processes (LIVENESS).

describe("ChatApp — DWD-5: a late out-of-phase onboarding event converges, process alive", () => {
  it("drops an onboarding-vocabulary event posted while engaged, then still processes a later in-phase event", () => {
    const actor = startChatApp();
    actor.send({ type: "org_found", org: { id: "org-1", name: "Acme Data" } });
    expect(lifecycle(actor)).toEqual({ engaged: "project_context" });
    // The onboarding child is STOPPED (its invoke was scoped to `login`).
    expect(childRef(actor, "onboarding")).toBeUndefined();

    const settledBefore = actor.getSnapshot().value;

    // A LATE onboarding-vocabulary event arrives while engaged. On the OLD
    // machine the root total forward sent into the stopped onboarding child and
    // the actor died. Here `engaged` has no handler → XState drops it.
    expect(() =>
      actor.send({ type: "org_created", org: { id: "org-9", name: "Late" } }),
    ).not.toThrow();

    // The actor is ALIVE and its settled snapshot is unchanged (no transition).
    expect(actor.getSnapshot().status).toBe("active");
    expect(actor.getSnapshot().value).toEqual(settledBefore);

    // LIVENESS: a SUBSEQUENT in-phase (project-context) event still processes,
    // proving event handling did not die with the dropped late event.
    actor.send({
      type: "scope_resolved",
      project: { id: "proj-A", name: "Project A" },
    });
    expect(lifecycle(actor)).toEqual({ engaged: "chat" });
  });
});
