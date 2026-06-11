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
  LoadSessionListInput,
  LoadSessionListOutput,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionChatMachineContext,
  SessionSummary,
} from "../session-chat/index.ts";
import { createChatApp } from "./index.ts";
import type { ChatUserIntent,OnboardingInput } from "./setup/types.ts";

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
  // Client-reported model: the onboarding child settles in awaiting_org_report
  // on start. Report the returning user's org THROUGH THE PARENT exactly as the
  // HTTP transport does — the parent's forwardChildEventToActiveChild spreads
  // `payload` to the event top-level and sendTo's the active child, so onboarding
  // receives { type:"org_found", org:{id,name} } → ready → parent advances.
  actor.send({
    type: "child_event",
    child_event: { type: "org_found", payload: { org: ORG } },
  });
  await waitFor(actor, (a) => childState(a, "session-chat") === "session_list_loaded");
  return { actor, rec };
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
// (re-verify failure / session_rejected retired under the client-reported model — CDO-S3 owns the new rejection path.)
