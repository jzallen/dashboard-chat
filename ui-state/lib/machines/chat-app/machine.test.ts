// Unit tests for the ChatApp coordinator (ADR-044, Phase 1) — PURE statechart
// tests driving the parent via a created actor with FAKE children provided over
// the placeholder slots (./fakes.ts). No network, no Redis, no boundaries.
//
// What is asserted, at the parent's driving port (its (lifecycle, connectivity)
// state value) + the fakes' recorded inboxes (`context.rx`):
//   - the happy cycle onboarding → project_context → chat advances on each
//     child's OWN readiness state (the onSnapshot watcher);
//   - the hand-offs land at the RIGHT child (auth_ready → project-context,
//     project_ready → session-chat);
//   - freeze/thaw: TOKEN_EXPIRED freezes; intents sent while frozen are HELD,
//     not forwarded; REAUTH_OK thaws + replays them IN ORDER; REAUTH_FAILED
//     rejects the session;
//   - freeze is ORTHOGONAL — it works in the onboarding + project_context
//     phases too;
//   - a project switch re-forwards project_ready to session-chat in place;
//   - unknown events are ignored (state-machine discipline).
//
// Children stay parent-ignorant (ADR-028): the test drives a child directly via
// its actor ref (the real WorkOS/backend drive in Phase 2), and the parent only
// ever watches + forwards.

import { describe, expect, it } from "vitest";
import { type AnyActorRef, createActor } from "xstate";

import {
  createChatAppWithFakes,
  type ReceivedEvent,
  TEST_INPUT,
} from "./fakes.ts";

type ChatApp = ReturnType<typeof startChatApp>;

function startChatApp() {
  return createActor(createChatAppWithFakes(), { input: TEST_INPUT }).start();
}

// ── reading the parent's (lifecycle, connectivity) value ──
function value(actor: ChatApp): { lifecycle: unknown; connectivity: unknown } {
  return actor.getSnapshot().value as {
    lifecycle: unknown;
    connectivity: unknown;
  };
}
const lifecycle = (actor: ChatApp) => value(actor).lifecycle;
const connectivity = (actor: ChatApp) => value(actor).connectivity;

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
function rxTypes(actor: ChatApp, id: string): string[] {
  return childRx(actor, id).map((event) => event.type);
}
function held(actor: ChatApp) {
  return actor.getSnapshot().context.held_events;
}

// ── drive the fakes (stand-ins for the real children's own progressions) ──
function driveOnboardingReady(
  actor: ChatApp,
  identity: { org_id: string; first_name: string },
) {
  childRef(actor, "session-onboarding").send({
    type: "DRIVE_READY",
    ...identity,
  });
}
function driveProjectSelected(
  actor: ChatApp,
  project: { project_id: string; project_name: string },
) {
  childRef(actor, "project-context").send({ type: "DRIVE_SELECT", ...project });
}
function userIntent(
  actor: ChatApp,
  intent:
    | { type: "session_clicked"; session_id: string }
    | { type: "new_session_clicked" }
    | { type: "refresh_session_list" },
) {
  actor.send({ type: "user_intent", intent });
}

const MAYA = { org_id: "org-acme", first_name: "Maya" };
const PROJECT_A = { project_id: "proj-A", project_name: "Project A" };

/** Drive the whole forward cycle to a settled chat session. */
function driveToChat(actor: ChatApp) {
  driveOnboardingReady(actor, MAYA);
  driveProjectSelected(actor, PROJECT_A);
}

describe("ChatApp — happy forward cycle", () => {
  it("starts in onboarding + live", () => {
    const actor = startChatApp();
    expect(lifecycle(actor)).toBe("onboarding");
    expect(connectivity(actor)).toBe("live");
  });

  it("advances onboarding → project_context when the onboarding child reaches ready", () => {
    const actor = startChatApp();
    driveOnboardingReady(actor, MAYA);
    expect(lifecycle(actor)).toEqual({ engaged: "project_context" });
  });

  it("advances project_context → chat when the project-context child selects a project", () => {
    const actor = startChatApp();
    driveToChat(actor);
    expect(lifecycle(actor)).toEqual({ engaged: "chat" });
    expect(connectivity(actor)).toBe("live");
  });

  it("routes the onboarding child to session_rejected → lifecycle rejected", () => {
    const actor = startChatApp();
    childRef(actor, "session-onboarding").send({ type: "DRIVE_REJECTED" });
    expect(lifecycle(actor)).toBe("rejected");
  });
});

describe("ChatApp — hand-offs reach the right child", () => {
  it("forwards auth_ready (with the captured org + identity) to project-context only", () => {
    const actor = startChatApp();
    driveOnboardingReady(actor, MAYA);

    const authReady = childRx(actor, "project-context").find(
      (event) => event.type === "auth_ready",
    );
    expect(authReady).toMatchObject({
      type: "auth_ready",
      org_id: "org-acme",
      user: { first_name: "Maya" },
    });
    // session-chat is not even invoked yet — it certainly has no auth_ready.
    expect(rxTypes(actor, "session-chat")).not.toContain("auth_ready");
  });

  it("forwards project_ready (with the selected project) to session-chat", () => {
    const actor = startChatApp();
    driveToChat(actor);

    const projectReady = childRx(actor, "session-chat").find(
      (event) => event.type === "project_ready",
    );
    expect(projectReady).toMatchObject({
      type: "project_ready",
      org_id: "org-acme",
      project_id: "proj-A",
      project_name: "Project A",
      request_id: TEST_INPUT.request_id,
    });
  });
});

describe("ChatApp — connectivity (freeze) in the chat phase", () => {
  it("forwards live intents straight to the active child", () => {
    const actor = startChatApp();
    driveToChat(actor);
    userIntent(actor, { type: "session_clicked", session_id: "s-live" });

    expect(
      childRx(actor, "session-chat").filter(
        (e) => e.type === "session_clicked",
      ),
    ).toEqual([{ type: "session_clicked", session_id: "s-live" }]);
  });

  it("TOKEN_EXPIRED flips connectivity live → frozen without touching lifecycle", () => {
    const actor = startChatApp();
    driveToChat(actor);
    actor.send({ type: "TOKEN_EXPIRED" });

    expect(connectivity(actor)).toBe("frozen");
    expect(lifecycle(actor)).toEqual({ engaged: "chat" });
  });

  it("HOLDS intents that arrive while frozen instead of forwarding them", () => {
    const actor = startChatApp();
    driveToChat(actor);
    const before = childRx(actor, "session-chat").length;

    actor.send({ type: "TOKEN_EXPIRED" });
    userIntent(actor, { type: "session_clicked", session_id: "s1" });
    userIntent(actor, { type: "session_clicked", session_id: "s2" });

    // Nothing reached the child; both are parked in the parent buffer.
    expect(childRx(actor, "session-chat").length).toBe(before);
    expect(held(actor)).toEqual([
      { type: "session_clicked", session_id: "s1" },
      { type: "session_clicked", session_id: "s2" },
    ]);
  });

  it("REAUTH_OK thaws and replays the held intents IN ORDER, then clears the buffer", () => {
    const actor = startChatApp();
    driveToChat(actor);

    actor.send({ type: "TOKEN_EXPIRED" });
    userIntent(actor, { type: "session_clicked", session_id: "s1" });
    userIntent(actor, { type: "refresh_session_list" });
    userIntent(actor, { type: "session_clicked", session_id: "s2" });
    actor.send({ type: "REAUTH_OK" });

    expect(connectivity(actor)).toBe("live");
    expect(held(actor)).toEqual([]);
    // The child received exactly the held intents, in the order they arrived.
    expect(
      rxTypes(actor, "session-chat").filter(
        (type) => type === "session_clicked" || type === "refresh_session_list",
      ),
    ).toEqual(["session_clicked", "refresh_session_list", "session_clicked"]);
    expect(
      childRx(actor, "session-chat")
        .filter((e) => e.type === "session_clicked")
        .map((e) => e.session_id),
    ).toEqual(["s1", "s2"]);
  });

  it("REAUTH_FAILED rejects the session and thaws the overlay", () => {
    const actor = startChatApp();
    driveToChat(actor);
    actor.send({ type: "TOKEN_EXPIRED" });
    actor.send({ type: "REAUTH_FAILED" });

    expect(lifecycle(actor)).toBe("rejected");
    expect(connectivity(actor)).toBe("live");
  });
});

describe("ChatApp — freeze is orthogonal to the lifecycle phase", () => {
  it("freezes + replays while still in the onboarding phase", () => {
    const actor = startChatApp();
    expect(lifecycle(actor)).toBe("onboarding");

    actor.send({ type: "TOKEN_EXPIRED" });
    expect(connectivity(actor)).toBe("frozen");
    expect(lifecycle(actor)).toBe("onboarding"); // untouched

    userIntent(actor, { type: "session_clicked", session_id: "s-onb" });
    expect(rxTypes(actor, "session-onboarding")).not.toContain(
      "session_clicked",
    );

    actor.send({ type: "REAUTH_OK" });
    expect(connectivity(actor)).toBe("live");
    expect(
      childRx(actor, "session-onboarding")
        .filter((e) => e.type === "session_clicked")
        .map((e) => e.session_id),
    ).toEqual(["s-onb"]);
  });

  it("freezes + replays while still in the project_context phase", () => {
    const actor = startChatApp();
    driveOnboardingReady(actor, MAYA);
    expect(lifecycle(actor)).toEqual({ engaged: "project_context" });

    actor.send({ type: "TOKEN_EXPIRED" });
    expect(connectivity(actor)).toBe("frozen");
    expect(lifecycle(actor)).toEqual({ engaged: "project_context" }); // untouched

    userIntent(actor, { type: "refresh_session_list" });
    // project-context has only the auth_ready hand-off so far — no intent leaked.
    expect(rxTypes(actor, "project-context")).not.toContain(
      "refresh_session_list",
    );

    actor.send({ type: "REAUTH_OK" });
    expect(rxTypes(actor, "project-context")).toContain("refresh_session_list");
  });
});

describe("ChatApp — project switch", () => {
  it("re-forwards project_ready to session-chat with the new project, in place", () => {
    const actor = startChatApp();
    driveToChat(actor);

    // One project_ready so far (the initial selection).
    expect(
      childRx(actor, "session-chat").filter((e) => e.type === "project_ready")
        .length,
    ).toBe(1);

    actor.send({ type: "PROJECT_SWITCH", new_project_id: "proj-B" });

    // Still in chat (re-forward in place, no phase change).
    expect(lifecycle(actor)).toEqual({ engaged: "chat" });
    const projectReadies = childRx(actor, "session-chat").filter(
      (e) => e.type === "project_ready",
    );
    expect(projectReadies.length).toBe(2);
    expect(projectReadies[1]).toMatchObject({
      type: "project_ready",
      project_id: "proj-B",
    });
  });

  it("does not re-forward when the same project is re-selected (idempotent)", () => {
    const actor = startChatApp();
    driveToChat(actor);
    // Re-send the SAME project id through the switch path.
    actor.send({ type: "PROJECT_SWITCH", new_project_id: "proj-A" });

    expect(
      childRx(actor, "session-chat").filter((e) => e.type === "project_ready")
        .length,
    ).toBe(1);
  });
});

describe("ChatApp — unknown events are ignored", () => {
  it("leaves (lifecycle, connectivity) unchanged and forwards nothing", () => {
    const actor = startChatApp();
    driveToChat(actor);
    const before = actor.getSnapshot().value;
    const chatRxBefore = childRx(actor, "session-chat").length;

    // An event the machine declares nowhere.
    actor.send({ type: "totally_unknown_event" } as never);

    expect(actor.getSnapshot().value).toEqual(before);
    expect(childRx(actor, "session-chat").length).toBe(chatRxBefore);
  });
});
