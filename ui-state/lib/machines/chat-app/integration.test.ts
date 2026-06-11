// In-process INTEGRATION tests for the ChatApp coordinator.
//
// These create + start a REAL wired ChatApp actor via the composition root
// (createChatApp, ./index.ts) with the THREE REAL child machines provided over
// the placeholder slots, and drive it end-to-end. ZERO EGRESS (CDO-S5): every
// child is report-driven and invokes NO server-side actor, so there are NO port
// mocks — the begin envelope carries no `config`/`deps` and both `ChatAppDeps`
// surfaces are empty. The cascade runs purely on client-reported outcome events.
// No HTTP, no Redis, no persistence.
//
// The covered observable sequences: happy login→project→chat and the report-only
// project switch (idempotent on same id) — asserted against the wired ChatApp,
// read at the parent's lifecycle value + the children's own state/context.

import { describe, expect, it } from "vitest";
import { type AnyActorRef, createActor } from "xstate";

import type {
  ProjectContextMachineContext,
  ProjectSummary,
} from "../project-context/index.ts";
import type {
  SessionChatMachineContext,
  SessionSummary,
} from "../session-chat/index.ts";
import { createChatApp } from "./index.ts";
import type { ChatUserIntent, OnboardingInput } from "./setup/types.ts";

// ───────────────────────────── fixtures ─────────────────────────────

const PRINCIPAL = "dev-user-001";
const ORG = { id: "org-acme", name: "Acme Data" };
const PROFILE = { email: "maya.chen@acme-data.example", name: "Maya Chen" };
const PROJECT_A: ProjectSummary = { id: "proj-A", name: "Project A" };

function session(id: string): SessionSummary {
  return { id, title: id.toUpperCase(), last_active_at: `2026-05-01T0${id.length}:00:00Z`, active_dataset_id: null };
}

/**
 * Build the ChatAppDeps — both child surfaces EMPTY under the zero-egress
 * report-driven model (CDO-S5). The machines transition on client-reported
 * outcome events, not invoked resolvers.
 */
function makeDeps(_sessions: SessionSummary[]) {
  return {
    projectContext: {},
    sessionChat: {},
  };
}

/** Begin envelope for a RETURNING user. Under the client-reported, zero-egress
 *  model (ADR-049/050/048) the onboarding child makes NO backend round-trip — it
 *  settles in awaiting_org_report and advances only when the CLIENT reports
 *  org_found / org_created (see arriveAtChat). Identity comes from the seeded
 *  `user` input (the single writer of context.user — INV-PCO). No `config`/`deps`
 *  egress fixture is threaded (the resolvers were deleted at CDO-S5). */
function makeInput(): OnboardingInput {
  return {
    request_id: "R-int-1",
    principal_id: PRINCIPAL,
    bearer_token: "tok-maya",
    user: { email: PROFILE.email, display_name: PROFILE.name, first_name: "Maya" },
  };
}

// ───────────────────────── snapshot readers ─────────────────────────

type ChatActor = ReturnType<typeof createActor>;

const lifecycle = (a: ChatActor) => a.getSnapshot().value;
const lastForwardedProject = (a: ChatActor) =>
  a.getSnapshot().context.last_forwarded_project_id;

function childRef(actor: ChatActor, id: string): AnyActorRef | undefined {
  return (actor.getSnapshot().children as Record<string, AnyActorRef>)[id];
}
function childState(actor: ChatActor, id: string): string | undefined {
  const snap = childRef(actor, id)?.getSnapshot() as { value?: unknown } | undefined;
  return snap ? (snap.value as string) : undefined;
}
/** Read an invoked child's context, narrowed to its known machine-context type
 *  by the caller (`childContext<ProjectContextMachineContext>(...)`). */
function childContext<T>(actor: ChatActor, id: string): T | undefined {
  const snap = childRef(actor, id)?.getSnapshot() as { context?: T } | undefined;
  return snap?.context;
}

/** Drive a session-phase UI intent RAW (CDO-S3 / ADR-049 §4 phase-gated
 *  routing): the parent forwards `{ type, ...fields }` verbatim to the live
 *  session-chat child — no `user_intent` envelope. */
function userIntent(actor: ChatActor, intent: ChatUserIntent) {
  actor.send(intent);
}

/** Poll the actor until `pred` holds (the children settle on async microtasks). */
async function waitFor(
  actor: ChatActor,
  pred: (a: ChatActor) => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (pred(actor)) return resolve();
      if (Date.now() >= deadline) {
        return reject(
          new Error(
            `waitFor: timeout — lifecycle=${JSON.stringify(lifecycle(actor))} ` +
              `session-chat=${childState(actor, "session-chat")}`,
          ),
        );
      }
      setTimeout(tick, 2);
    };
    tick();
  });
}

/** Drive the full forward cycle to a settled session-chat list (the common
 *  arrange step). Returns the started actor. */
async function arriveAtChat(sessions: SessionSummary[] = [session("s1")]) {
  const actor = createActor(createChatApp(makeDeps(sessions)), {
    input: makeInput(),
  }).start();
  // Client-reported model + phase-gated routing (CDO-S3 / ADR-049 §4): the
  // onboarding child settles in awaiting_org_report on start. Report the
  // returning user's org THROUGH THE PARENT exactly as the HTTP transport does —
  // the parent's login.on forwards { type:"org_found", org:{id,name} } VERBATIM
  // to the live onboarding child → ready → parent advances to
  // engaged.project_context.
  actor.send({ type: "org_found", org: ORG });
  // The project-context child now waits in awaiting_scope_report (no server-side
  // resolve). Report the resolved scope THROUGH THE PARENT — engaged.on forwards
  // { type:"scope_resolved", project:{id,name} } verbatim → project_selected →
  // parent advances to engaged.chat → session-chat enters
  // awaiting_session_list_report (no egress — DR-8).
  await waitFor(actor, (a) => childState(a, "project-context") === "awaiting_scope_report");
  actor.send({ type: "scope_resolved", project: PROJECT_A });
  await waitFor(actor, (a) => childState(a, "session-chat") === "awaiting_session_list_report");
  // Report-driven session-chat (ADR-050 §e.5 / DR-8): the client probes
  // GET /sessions and REPORTS session_list_loaded; the parent forwards it
  // verbatim → session_list_loaded.
  reportSessionList(actor, sessions);
  await waitFor(actor, (a) => childState(a, "session-chat") === "session_list_loaded");
  return { actor };
}

/** Report a client-observed session list THROUGH THE PARENT (the parent forwards
 *  it verbatim to the live session-chat child). */
function reportSessionList(actor: ChatActor, sessions: SessionSummary[]) {
  actor.send({
    type: "session_list_loaded",
    sessions,
    next_cursor: null,
    has_more: false,
  });
}

// ─────────────────────────── scenario 1 ───────────────────────────

describe("ChatApp Phase 2 — happy forward cycle (login → project → chat)", () => {
  it("advances onboarding(ready) → project_context(project_selected) → chat, threading both hand-offs", async () => {
    const { actor } = await arriveAtChat();

    // Parent settled in chat.
    expect(lifecycle(actor)).toEqual({ engaged: "chat" });

    // onboarding resolved the returning user's org + identity and was then
    // stopped (its invoke is scoped to the `onboarding` state, left behind on
    // the advance); the parent captured the hand-off on the way out.
    expect(childRef(actor, "onboarding")).toBeUndefined();
    expect(actor.getSnapshot().context.auth_handoff).toEqual({
      org_id: "org-acme",
      user: { first_name: "Maya" },
    });

    // auth_ready hand-off reached project-context (org_id + first_name).
    expect(childState(actor, "project-context")).toBe("project_selected");
    expect(childContext<ProjectContextMachineContext>(actor, "project-context")!.org_id).toBe("org-acme");
    expect(childContext<ProjectContextMachineContext>(actor, "project-context")!.user.first_name).toBe("Maya");
    expect(childContext<ProjectContextMachineContext>(actor, "project-context")!.project.id).toBe("proj-A");

    // project_ready hand-off reached session-chat (org_id + project).
    expect(childContext<SessionChatMachineContext>(actor, "session-chat")!.org_id).toBe("org-acme");
    expect(childContext<SessionChatMachineContext>(actor, "session-chat")!.project.id).toBe("proj-A");

    // The session list the client reported landed in the session-chat region.
    expect(childContext<SessionChatMachineContext>(actor, "session-chat")!.session_list).toEqual([
      session("s1"),
    ]);

    // A live user intent reaches the active child; the client then reports the
    // resume outcome THROUGH THE PARENT (zero egress), driving session_active.
    userIntent(actor, { type: "session_clicked", session_id: "s1" });
    actor.send({ type: "session_resumed", session_id: "s1", transcript: [] });
    await waitFor(actor, (a) => childState(a, "session-chat") === "session_active");
    expect(childContext<SessionChatMachineContext>(actor, "session-chat")!.session_id).toBe("s1");
  });
});

// ─────────────────────────── scenario 2 ───────────────────────────

describe("ChatApp Phase 2 — report-only project switch while in chat", () => {
  it("re-lands project-context and re-forwards project_ready in place for a NEW project", async () => {
    const { actor } = await arriveAtChat();
    expect(childState(actor, "session-chat")).toBe("session_list_loaded");

    // REPORT-ONLY switch (CDO-S3 / ADR-049 §4): the client reports the new
    // project it probed. engaged.on forwards `project_switched` verbatim to
    // project-context (alive even while session-chat is the active sub-child) →
    // project_selected re-enters on proj-B → shouldSwitchProject re-forwards
    // project_ready → session-chat re-enters awaiting_session_list_report for
    // proj-B (report-driven — no egress).
    actor.send({
      type: "project_switched",
      project: { id: "proj-B", name: "Project B" },
    });

    await waitFor(actor, (a) => childContext<SessionChatMachineContext>(a, "session-chat")?.project.id === "proj-B");
    expect(lifecycle(actor)).toEqual({ engaged: "chat" }); // re-forward in place
    expect(childContext<ProjectContextMachineContext>(actor, "project-context")!.project.id).toBe("proj-B");
    // The re-forwarded project_ready reset session-chat into the awaiting state
    // for the new project (the no-egress successor to a list reload).
    expect(childState(actor, "session-chat")).toBe("awaiting_session_list_report");
    expect(lastForwardedProject(actor)).toBe("proj-B");
  });

  it("is idempotent on a same-id switch report (no re-forward, no session-chat reload)", async () => {
    const { actor } = await arriveAtChat();

    // First switch report to proj-B re-enters session-chat awaiting for proj-B.
    actor.send({
      type: "project_switched",
      project: { id: "proj-B", name: "Project B" },
    });
    await waitFor(actor, (a) => childContext<SessionChatMachineContext>(a, "session-chat")?.project.id === "proj-B");
    expect(childState(actor, "session-chat")).toBe("awaiting_session_list_report");
    // Re-settle the list so a redundant same-id switch can be proven a no-op.
    reportSessionList(actor, [session("s1")]);
    await waitFor(actor, (a) => childState(a, "session-chat") === "session_list_loaded");

    // A redundant switch report to the SAME project: project-context re-enters
    // project_selected (settling on proj-B again), but the parent's
    // shouldSwitchProject guard sees the unchanged id and blocks the re-forward,
    // so session-chat does NOT reset back to awaiting.
    actor.send({
      type: "project_switched",
      project: { id: "proj-B", name: "Project B" },
    });
    await waitFor(
      actor,
      (a) =>
        (childContext<ProjectContextMachineContext>(a, "project-context")!
          .scope_reconciled_count ?? 0) === 2,
    );
    expect(childState(actor, "session-chat")).toBe("session_list_loaded"); // unchanged — no reset
    expect(lastForwardedProject(actor)).toBe("proj-B");
  });
});

// ─────────────────────────── scenario 3 ───────────────────────────
// (re-verify failure / session_rejected retired under the client-reported model — CDO-S3 owns the new rejection path.)
