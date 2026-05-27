// In-process INTEGRATION tests for the ChatApp coordinator (ADR-044, Phase 2).
//
// These create + start a REAL wired ChatApp actor via the composition root
// (createChatApp, ./index.ts) with the THREE REAL child machines provided over
// the placeholder slots, and drive it end-to-end. The ONLY mocks are at the
// children's PORT boundaries (ADR-028): the onboarding child's `fetch` (injected
// via the begin envelope's `deps.request_client`, the same makeMockFetch the
// onboarding unit tests use), and the project-context / session-chat resolver
// ACTORS (injected as `fromPromise` fakes at construction, the same fixture
// style their own machine.test.ts files use). No HTTP, no Redis, no persistence
// (Phases 3-4).
//
// The orchestrator tests are the behavioral reference for the SAME observable
// sequences (orchestrator.test.ts, orchestrator-freeze-replay.test.ts,
// orchestrator-switching-project.test.ts): happy login→project→chat, project
// switch (idempotent on same id), token-expiry freeze→reauth→thaw replay, and
// session_rejected. We assert the SAME behavior against the wired ChatApp, read
// at the parent's (lifecycle, connectivity) value + the invoked children's own
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
  LoadSessionListInput,
  LoadSessionListOutput,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionChatMachineContext,
  SessionSummary,
} from "../session-chat/index.ts";
import { createChatApp } from "./index.ts";
import type { SessionOnboardingInput, ChatUserIntent } from "./setup/types.ts";

// ───────────────────────────── fixtures ─────────────────────────────

const PRINCIPAL = "dev-user-001";
const ORG = { id: "org-acme", name: "Acme Data" };
const PROFILE = { email: "maya.chen@acme-data.example", name: "Maya Chen" };
const PROJECT_A: ProjectSummary = { id: "proj-A", name: "Project A" };

function session(id: string): SessionSummary {
  return { id, title: id.toUpperCase(), last_active_at: `2026-05-01T0${id.length}:00:00Z`, active_dataset_id: null };
}

/** A recorder for what the (real) children's mocked ports actually received —
 *  the in-process analog of the orchestrator tests' projection assertions. */
interface Recorder {
  loadCalls: string[]; // project_id per loadSessionList invoke
  resumeCalls: string[]; // session_id per resumeSession invoke
  switchCalls: string[]; // new_project_id per switchProject invoke
}

/**
 * Build the ChatAppDeps with `fromPromise` fakes at every child port. The
 * project-context + session-chat actors are construction-time deps; the
 * onboarding child's I/O is the begin envelope (see makeInput), so it is NOT a
 * construction dep. Explicit `fromPromise<Out, In>` generics keep each fake's
 * output assignable to the union the child's deps slot expects.
 */
function makeDeps(rec: Recorder, sessions: SessionSummary[]) {
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
    sessionChat: {
      loadSessionList: fromPromise<LoadSessionListOutput, LoadSessionListInput>(
        async ({ input }) => {
          rec.loadCalls.push(input.project_id);
          return {
            items: sessions,
            next_cursor: null,
            has_more: false,
            resume_target: input.pending_resume_session_id ?? null,
          };
        },
      ),
      resumeSession: fromPromise<ResumeSessionOutput, ResumeSessionInput>(
        async ({ input }) => {
          rec.resumeCalls.push(input.session_id);
          return { session_id: input.session_id, transcript: [], active_dataset_id: null };
        },
      ),
    },
  };
}

/** Begin envelope for a RETURNING user (org present → onboarding lands `ready`
 *  directly). `deps.request_client` is the mock fetch the onboarding resolvers
 *  call. Pass `badToken` to drive the re-verify 401 → session_rejected path. */
function makeInput(opts: { badToken?: boolean } = {}): SessionOnboardingInput {
  const bearer_token = opts.badToken ? "tok-bad" : "tok-maya";
  return {
    request_id: "R-int-1",
    principal_id: PRINCIPAL,
    bearer_token,
    config: makeTestConfig(),
    deps: {
      request_client: makeMockFetch({
        profile: PROFILE,
        existingOrg: ORG,
        ...(opts.badToken ? { badToken: "tok-bad" } : {}),
      }),
    },
  };
}

// ───────────────────────── snapshot readers ─────────────────────────

type ChatActor = ReturnType<typeof createActor>;

function value(actor: ChatActor): { lifecycle: unknown; connectivity: unknown } {
  return actor.getSnapshot().value as { lifecycle: unknown; connectivity: unknown };
}
const lifecycle = (a: ChatActor) => value(a).lifecycle;
const connectivity = (a: ChatActor) => value(a).connectivity;
const held = (a: ChatActor) => a.getSnapshot().context.held_events;
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

function userIntent(actor: ChatActor, intent: ChatUserIntent) {
  actor.send({ type: "user_intent", intent });
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
  const rec: Recorder = { loadCalls: [], resumeCalls: [], switchCalls: [] };
  const actor = createActor(createChatApp(makeDeps(rec, sessions)), {
    input: makeInput(),
  }).start();
  await waitFor(actor, (a) => childState(a, "session-chat") === "session_list_loaded");
  return { actor, rec };
}

// ─────────────────────────── scenario 1 ───────────────────────────

describe("ChatApp Phase 2 — happy forward cycle (login → project → chat)", () => {
  it("advances onboarding(ready) → project_context(project_selected) → chat, threading both hand-offs", async () => {
    const { actor, rec } = await arriveAtChat();

    // Parent settled in chat + live.
    expect(lifecycle(actor)).toEqual({ engaged: "chat" });
    expect(connectivity(actor)).toBe("live");

    // onboarding resolved the returning user's org + identity and was then
    // stopped (its invoke is scoped to the `onboarding` state, left behind on
    // the advance); the parent captured the hand-off on the way out.
    expect(childRef(actor, "session-onboarding")).toBeUndefined();
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

    // Idempotent: project_ready forwarded EXACTLY once for proj-A even though
    // project-context may emit project_selected more than once (initial invoke
    // + the auth_ready re-resolve). A double-forward would reenter
    // loading_session_list and push a 2nd "proj-A" — there is exactly one.
    expect(rec.loadCalls).toEqual(["proj-A"]);

    // A live user intent reaches the active child and drives it to session_active.
    userIntent(actor, { type: "session_clicked", session_id: "s1" });
    await waitFor(actor, (a) => childState(a, "session-chat") === "session_active");
    expect(rec.resumeCalls).toEqual(["s1"]);
    expect(childContext<SessionChatMachineContext>(actor, "session-chat")!.session_id).toBe("s1");
  });
});

// ─────────────────────────── scenario 2 ───────────────────────────

describe("ChatApp Phase 2 — project switch while in chat", () => {
  it("re-drives project-context and re-forwards project_ready in place for a NEW project", async () => {
    const { actor, rec } = await arriveAtChat();
    expect(rec.loadCalls).toEqual(["proj-A"]);

    actor.send({ type: "PROJECT_SWITCH", new_project_id: "proj-B" });

    // project-context ran its switch path; session-chat reloaded for proj-B.
    await waitFor(actor, (a) => childContext<SessionChatMachineContext>(a, "session-chat")?.project.id === "proj-B");
    expect(lifecycle(actor)).toEqual({ engaged: "chat" }); // re-forward in place
    expect(rec.switchCalls).toEqual(["proj-B"]);
    expect(childContext<ProjectContextMachineContext>(actor, "project-context")!.project.id).toBe("proj-B");
    expect(rec.loadCalls).toEqual(["proj-A", "proj-B"]);
    expect(lastForwardedProject(actor)).toBe("proj-B");
  });

  it("is idempotent on a same-id switch (no re-forward, no session-chat reload)", async () => {
    const { actor, rec } = await arriveAtChat();

    // First switch to proj-B reloads session-chat once.
    actor.send({ type: "PROJECT_SWITCH", new_project_id: "proj-B" });
    await waitFor(actor, (a) => childContext<SessionChatMachineContext>(a, "session-chat")?.project.id === "proj-B");
    expect(rec.loadCalls).toEqual(["proj-A", "proj-B"]);

    // A redundant switch to the SAME project: project-context still runs its
    // switch (settling on proj-B again), but the parent's guard blocks the
    // re-forward, so session-chat does NOT reload.
    actor.send({ type: "PROJECT_SWITCH", new_project_id: "proj-B" });
    await waitFor(actor, () => rec.switchCalls.length === 2);
    expect(rec.switchCalls).toEqual(["proj-B", "proj-B"]);
    expect(rec.loadCalls).toEqual(["proj-A", "proj-B"]); // unchanged — no reload
    expect(lastForwardedProject(actor)).toBe("proj-B");
  });
});

// ─────────────────────────── scenario 3 ───────────────────────────

describe("ChatApp Phase 2 — token-expiry freeze → reauth → thaw", () => {
  it("HOLDS user intents (in arrival order) while frozen, forwarding none", async () => {
    const { actor, rec } = await arriveAtChat([session("s1"), session("s2")]);

    actor.send({ type: "TOKEN_EXPIRED" });
    expect(connectivity(actor)).toBe("frozen");
    expect(lifecycle(actor)).toEqual({ engaged: "chat" }); // orthogonal — untouched

    userIntent(actor, { type: "refresh_session_list" });
    userIntent(actor, { type: "session_clicked", session_id: "s1" });

    // Buffered in order; nothing reached the active child.
    expect(held(actor)).toEqual([
      { type: "refresh_session_list" },
      { type: "session_clicked", session_id: "s1" },
    ]);
    expect(rec.loadCalls).toEqual(["proj-A"]); // the refresh was NOT processed
    expect(rec.resumeCalls).toEqual([]);
    expect(childState(actor, "session-chat")).toBe("session_list_loaded");
  });

  it("REAUTH_OK thaws and replays the held intent to the active child", async () => {
    const { actor, rec } = await arriveAtChat();

    actor.send({ type: "TOKEN_EXPIRED" });
    userIntent(actor, { type: "session_clicked", session_id: "s1" });
    expect(held(actor)).toHaveLength(1);
    expect(rec.resumeCalls).toEqual([]); // held, not forwarded

    actor.send({ type: "REAUTH_OK" });
    expect(connectivity(actor)).toBe("live");
    expect(held(actor)).toEqual([]); // buffer cleared

    // The replayed session_clicked drove the REAL session-chat into resume.
    await waitFor(actor, (a) => childState(a, "session-chat") === "session_active");
    expect(rec.resumeCalls).toEqual(["s1"]);
    expect(childContext<SessionChatMachineContext>(actor, "session-chat")!.session_id).toBe("s1");
  });

  it("REAUTH_OK delivers multiple held intents to the active child in arrival order", async () => {
    // Hold [refresh, click]: refresh transitions session-chat to
    // loading_session_list which does NOT accept session_clicked, so the
    // second intent is dropped at the child mailbox. That observable
    // asymmetry — loadCalls grows but resumeCalls stays empty — is the
    // signature of "refresh was delivered FIRST." A swapped delivery would
    // run resume first and drop the refresh, producing the opposite recorder.
    const { actor, rec } = await arriveAtChat();
    expect(rec.loadCalls).toEqual(["proj-A"]); // initial load

    actor.send({ type: "TOKEN_EXPIRED" });
    userIntent(actor, { type: "refresh_session_list" });
    userIntent(actor, { type: "session_clicked", session_id: "s1" });
    expect(held(actor)).toEqual([
      { type: "refresh_session_list" },
      { type: "session_clicked", session_id: "s1" },
    ]);

    actor.send({ type: "REAUTH_OK" });
    expect(held(actor)).toEqual([]); // buffer cleared on replay

    // Wait for the refresh-driven reload to settle.
    await waitFor(actor, (a) => childState(a, "session-chat") === "session_list_loaded");
    expect(rec.loadCalls).toEqual(["proj-A", "proj-A"]); // refresh delivered
    expect(rec.resumeCalls).toEqual([]); // click arrived while busy, dropped
  });

  it("REAUTH_FAILED rejects the session and thaws the overlay", async () => {
    const { actor } = await arriveAtChat();

    actor.send({ type: "TOKEN_EXPIRED" });
    expect(connectivity(actor)).toBe("frozen");
    actor.send({ type: "REAUTH_FAILED" });

    expect(lifecycle(actor)).toBe("user_rejected");
    expect(connectivity(actor)).toBe("live");
  });
});

// ─────────────────────────── scenario 4 ───────────────────────────

describe("ChatApp Phase 2 — onboarding re-verify failure", () => {
  it("rejects the user when re-verify fails, no advance to engaged", async () => {
    const rec: Recorder = { loadCalls: [], resumeCalls: [], switchCalls: [] };
    const actor = createActor(createChatApp(makeDeps(rec, [session("s1")])), {
      input: makeInput({ badToken: true }),
    }).start();

    await waitFor(actor, (a) => lifecycle(a) === "user_rejected");

    expect(lifecycle(actor)).toBe("user_rejected");
    expect(connectivity(actor)).toBe("live");
    // The engaged region was never entered → no project-context / session-chat
    // child, and no downstream port was ever touched.
    expect(childRef(actor, "project-context")).toBeUndefined();
    expect(childRef(actor, "session-chat")).toBeUndefined();
    expect(rec.loadCalls).toEqual([]);
  });
});
