// In-process INTEGRATION tests for the ChatApp coordinator.
//
// These create + start a REAL wired ChatApp actor via the composition root
// (createChatApp, ./index.ts) with the THREE REAL child machines provided over
// the placeholder slots, and drive it end-to-end. The ONLY mocks are at the
// children's PORT boundaries: the onboarding child's `fetch` (injected via the
// begin envelope's `deps.request_client`, the same makeMockFetch the onboarding
// unit tests use), and the project-context / session-chat resolver ACTORS
// (injected as `fromPromise` fakes at construction, the same fixture style their
// own machine.test.ts files use). No HTTP, no Redis, no persistence.
//
// The covered observable sequences: happy login→project→chat, project switch
// (idempotent on same id), and session_rejected — asserted against the wired
// ChatApp, read at the parent's lifecycle value + the invoked children's own
// state/context + the recorded port calls.

import { describe, expect, it } from "vitest";
import { type AnyActorRef, createActor, fromPromise } from "xstate";

import { makeMockFetch, makeTestConfig } from "../../testing/test-config.ts";
import type {
  CreateProjectInput,
  ProjectContextMachineContext,
  ProjectSummary,
  ResolveInitialScopeInput,
  ResolveInitialScopeOutput,
  SwitchProjectInput,
  SwitchProjectOutput,
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

/** A recorder for what the (real) children's mocked ports actually received —
 *  the in-process analog of the orchestrator tests' projection assertions.
 *  Report-driven session-chat (ADR-050 §e.5 / DR-8) invokes NO actors, so its
 *  list/resume egress is no longer recorded — the test instead asserts the
 *  region's observable state after the client reports the outcome. Only the
 *  still-invoke project-context switch is recorded. */
interface Recorder {
  switchCalls: string[]; // new_project_id per switchProject invoke
}

/**
 * Build the ChatAppDeps with `fromPromise` fakes at the still-invoke child
 * ports. The project-context actors are construction-time deps; the onboarding
 * child's I/O is the begin envelope (see makeInput). Report-driven session-chat
 * invokes nothing, so its deps surface is empty.
 */
function makeDeps(rec: Recorder, _sessions: SessionSummary[]) {
  return {
    projectContext: {
      resolveInitialScope: fromPromise<ResolveInitialScopeOutput, ResolveInitialScopeInput>(
        async () => ({ project: PROJECT_A }),
      ),
      createProject: fromPromise<ProjectSummary, CreateProjectInput>(
        async () => PROJECT_A,
      ),
      switchProject: fromPromise<SwitchProjectOutput, SwitchProjectInput>(
        async ({ input }) => {
          rec.switchCalls.push(input.new_project_id);
          return { project: { id: input.new_project_id, name: `Project ${input.new_project_id}` } };
        },
      ),
    },
    sessionChat: {},
  };
}

/** Begin envelope for a RETURNING user. Under the client-reported model
 *  (ADR-049/050) the onboarding child no longer probes the server — it settles
 *  in awaiting_org_report and advances only when the CLIENT reports org_found /
 *  org_created (see arriveAtChat). Identity comes from the seeded `user` input
 *  (the single writer of context.user — INV-PCO), not a fetch round-trip. The
 *  `deps.request_client` is kept to preserve the OnboardingInput shape (the
 *  onboarding machine still declares loadSession/createOrg actor defaults); it is
 *  no longer load-bearing for these tests. */
function makeInput(): OnboardingInput {
  return {
    request_id: "R-int-1",
    principal_id: PRINCIPAL,
    bearer_token: "tok-maya",
    config: makeTestConfig(),
    user: { email: PROFILE.email, display_name: PROFILE.name, first_name: "Maya" },
    deps: {
      request_client: makeMockFetch({ profile: PROFILE, existingOrg: ORG }),
    },
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
 *  arrange step). Returns the started actor + its recorder. */
async function arriveAtChat(sessions: SessionSummary[] = [session("s1")]) {
  const rec: Recorder = { switchCalls: [] };
  const actor = createActor(createChatApp(makeDeps(rec, sessions)), {
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
  return { actor, rec };
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
    const { actor, rec } = await arriveAtChat();

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
