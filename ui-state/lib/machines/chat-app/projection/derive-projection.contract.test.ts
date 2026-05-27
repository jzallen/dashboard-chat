// R1 GOLDEN / CONTRACT tests — the byte-stability gate for the derived-view
// projection mapper (ADR-044 §C2, review §6 R1 — the HIGHEST risk).
//
// For each scenario the integration suite already exercises, we:
//   1. drive a REAL wired ChatApp (Phase-2 composition root, mocked child ports)
//      to the target state,
//   2. snapshot it (actor.getSnapshot()),
//   3. run deriveProjection() for each affected wire machine, and
//   4. assert the resulting FlowProjection EQUALS, field-by-field, what
//      buildProjection() folds from the EQUIVALENT per-machine event log.
//
// This is what prevents a silent break of the ADR-027 wire contract. The
// equivalent log is the event sequence the orchestrator appends today for that
// machine in that state (verified against projection.ts's handlers). Bookkeeping
// (sequence_id/last_event_at/request_id) is sourced from that log via
// bookkeepingFromLog — the hybrid design keeps it log-sourced (ADR-044 §2).
//
// Specifically pinned (the load-bearing reads):
//   - auth-proxy KPI sniffer literals: state ∈ {"ready","error_recoverable"},
//     context.underlying_cause_tag, and the absence of a spurious
//     context.silent_reauth_ok (the field is unset in both fold + derive today).
//   - FE root/route loader reads: context.org{id,name}, context.user
//     {first_name,display_name}, context.project{id,name}, context.session_list,
//     active_scope.

import { describe, expect, it } from "vitest";
import { type AnyActorRef, createActor, fromPromise } from "xstate";

import { FlowEvent } from "../../../domain/flow-event.ts";
import { buildProjection } from "../../../domain/projection.ts";
import { makeMockFetch, makeTestConfig } from "../../../testing/test-config.ts";
import type {
  CreateProjectInput,
  ProjectSummary,
  ResolveInitialScopeInput,
  ResolveInitialScopeOutput,
  SwitchProjectInput,
  SwitchProjectOutput,
} from "../../project-context/index.ts";
import type {
  LoadSessionListInput,
  LoadSessionListOutput,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionSummary,
} from "../../session-chat/index.ts";
import { createChatApp } from "../index.ts";
import type { SessionOnboardingInput, ChatUserIntent } from "../setup/types.ts";
import {
  bookkeepingFromLog,
  type ChatAppSnapshotView,
  deriveProjection,
  LOGIN_AND_ORG_SETUP,
  PROJECT_AND_CHAT_SESSION_MANAGEMENT,
  SESSION_CHAT,
} from "./derive-projection.ts";

// ───────────────────────────── fixtures ─────────────────────────────

const PRINCIPAL = "dev-user-001";
const REQ = "R-int-1";
const TS = "2026-05-11T22:00:00.000Z";
const ORG = { id: "org-acme", name: "Acme Data" };
const PROFILE = { email: "maya.chen@acme-data.example", name: "Maya Chen" };
const PROJECT_A: ProjectSummary = { id: "proj-A", name: "Project A" };

function session(id: string): SessionSummary {
  return {
    id,
    title: id.toUpperCase(),
    last_active_at: `2026-05-01T0${id.length}:00:00Z`,
    active_dataset_id: null,
  };
}

interface Recorder {
  loadCalls: string[];
  resumeCalls: string[];
  switchCalls: string[];
}

function recorder(): Recorder {
  return { loadCalls: [], resumeCalls: [], switchCalls: [] };
}

type Deferred = { promise: Promise<SwitchProjectOutput>; resolve: () => void };
function deferredSwitch(projectId: string): Deferred {
  let resolve!: () => void;
  const promise = new Promise<SwitchProjectOutput>((res) => {
    resolve = () =>
      res({ project: { id: projectId, name: `Project ${projectId}` } });
  });
  return { promise, resolve };
}

/** ChatAppDeps with fromPromise fakes at every child port (mocks ONLY at the
 *  port boundary, ADR-028). `slowSwitch`, when given, parks project-context in
 *  switching_project until its promise is resolved by hand. */
function makeDeps(
  rec: Recorder,
  sessions: SessionSummary[],
  slowSwitch?: Deferred,
) {
  return {
    projectContext: {
      resolveInitialScope: fromPromise<
        ResolveInitialScopeOutput,
        ResolveInitialScopeInput
      >(async () => ({ project: PROJECT_A })),
      createProject: fromPromise<ProjectSummary, CreateProjectInput>(
        async () => PROJECT_A,
      ),
      switchProject: fromPromise<SwitchProjectOutput, SwitchProjectInput>(
        async ({ input }) => {
          rec.switchCalls.push(input.new_project_id);
          if (slowSwitch) return slowSwitch.promise;
          return {
            project: {
              id: input.new_project_id,
              name: `Project ${input.new_project_id}`,
            },
          };
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
          return {
            session_id: input.session_id,
            transcript: [],
            active_dataset_id: null,
          };
        },
      ),
    },
  };
}

function makeInput(opts: { badToken?: boolean; newUser?: boolean } = {}): SessionOnboardingInput {
  const bearer_token = opts.badToken ? "tok-bad" : "tok-maya";
  return {
    request_id: REQ,
    principal_id: PRINCIPAL,
    bearer_token,
    config: makeTestConfig(),
    deps: {
      request_client: makeMockFetch({
        profile: PROFILE,
        ...(opts.newUser ? {} : { existingOrg: ORG }),
        ...(opts.badToken ? { badToken: "tok-bad" } : {}),
      }),
    },
  };
}

// ───────────────────────── snapshot readers ─────────────────────────

type ChatActor = ReturnType<typeof createActor>;

/** The mapper reads a live actor's getSnapshot(); the codebase's established
 *  snapshot-view cast convention bridges XState's complex generic snapshot type
 *  to the narrow shape deriveProjection declares. */
function view(actor: ChatActor): ChatAppSnapshotView {
  return actor.getSnapshot() as unknown as ChatAppSnapshotView;
}
function lifecycle(actor: ChatActor): unknown {
  return (actor.getSnapshot().value as { lifecycle: unknown }).lifecycle;
}
function childRef(actor: ChatActor, id: string): AnyActorRef | undefined {
  return (actor.getSnapshot().children as Record<string, AnyActorRef>)[id];
}
function childState(actor: ChatActor, id: string): string | undefined {
  const snap = childRef(actor, id)?.getSnapshot() as { value?: unknown } | undefined;
  return snap ? (snap.value as string) : undefined;
}

function ev(
  flowKey: string,
  type: string,
  payload: Record<string, unknown> = {},
): FlowEvent {
  return FlowEvent.fromCache(flowKey, { ts: TS, type, payload, request_id: REQ });
}

/** buildProjection from an equivalent log, keyed by the wire flow_id. */
function golden(wireMachine: string, events: FlowEvent[]) {
  return buildProjection(`${wireMachine}:${PRINCIPAL}`, events);
}

/** Run the derived mapper for a wire machine, with bookkeeping from the same log
 *  the golden uses (so the comparison isolates state/context/active_scope). */
function derived(actor: ChatActor, wireMachine: string, events: FlowEvent[]) {
  return deriveProjection(view(actor), wireMachine, bookkeepingFromLog(events));
}

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
        return reject(new Error(`waitFor timeout: lifecycle=${JSON.stringify(lifecycle(actor))}`));
      }
      setTimeout(tick, 2);
    };
    tick();
  });
}

async function arriveAtChat(
  sessions: SessionSummary[] = [session("s1")],
  slowSwitch?: Deferred,
) {
  const rec = recorder();
  const actor = createActor(createChatApp(makeDeps(rec, sessions, slowSwitch)), {
    input: makeInput(),
  }).start();
  await waitFor(actor, (a) => childState(a, "session-chat") === "session_list_loaded");
  return { actor, rec };
}

// The login flow's equivalent log for the returning user (org present).
const LOGIN_LOG = "login-and-org-setup:" + PRINCIPAL;
const PC_LOG = PROJECT_AND_CHAT_SESSION_MANAGEMENT + ":" + PRINCIPAL;
const SC_LOG = SESSION_CHAT + ":" + PRINCIPAL;

const loginReadyEvents = () => [
  ev(LOGIN_LOG, "session_started", {
    user: {
      email: PROFILE.email,
      display_name: PROFILE.name,
      first_name: "Maya",
    },
    org: { id: ORG.id, name: ORG.name },
  }),
];
const pcSelectedEvents = () => [
  ev(PC_LOG, "project_context_resolution_started", {
    org_id: ORG.id,
    user: { first_name: "Maya" },
  }),
  ev(PC_LOG, "project_selected", {
    org_id: ORG.id,
    project: { id: PROJECT_A.id, name: PROJECT_A.name },
  }),
];
const scListLoadedEvents = (sessions: SessionSummary[]) => [
  ev(SC_LOG, "project_context_inherited", {
    org_id: ORG.id,
    project_id: PROJECT_A.id,
    project_name: PROJECT_A.name,
  }),
  ev(SC_LOG, "session_list_load_started"),
  ev(SC_LOG, "session_list_loaded", {
    items: sessions,
    next_cursor: null,
    has_more: false,
  }),
];

// ═════════════════════════ Scenario 1 — happy login → project → chat ═════════════════════════

describe("R1 — happy login → project → chat (all three machines byte-identical)", () => {
  it("derives login-and-org-setup = ready (org + user) after the onboarding child is stopped", async () => {
    const { actor } = await arriveAtChat();
    // The phase-scoped onboarding child is gone at chat steady state.
    expect(childRef(actor, "session-onboarding")).toBeUndefined();

    const out = derived(actor, LOGIN_AND_ORG_SETUP, loginReadyEvents());
    expect(out).toEqual(golden(LOGIN_AND_ORG_SETUP, loginReadyEvents()));

    // Pin the FE root-loader reads + auth-proxy ready literal explicitly.
    expect(out.state).toBe("ready");
    expect(out.context.org).toEqual({ id: "org-acme", name: "Acme Data" });
    expect(out.context.user).toEqual({
      email: PROFILE.email,
      display_name: "Maya Chen",
      first_name: "Maya",
    });
    expect(out.active_scope).toEqual({
      org_id: "org-acme",
      project_id: null,
      resource_type: null,
      resource_id: null,
    });
    // auth-proxy silent_reauth_ok literal: NOT set today (neither fold nor
    // derive) → the KPI branch stays dorment, byte-stable.
    expect(out.context.silent_reauth_ok).toBeUndefined();
  });

  it("derives project-and-chat-session-management = project_selected (project + scope)", async () => {
    const { actor } = await arriveAtChat();
    const out = derived(actor, PROJECT_AND_CHAT_SESSION_MANAGEMENT, pcSelectedEvents());
    expect(out).toEqual(golden(PROJECT_AND_CHAT_SESSION_MANAGEMENT, pcSelectedEvents()));

    expect(out.state).toBe("project_selected");
    expect(out.context.project).toEqual({ id: "proj-A", name: "Project A" });
    expect(out.active_scope).toEqual({
      org_id: "org-acme",
      project_id: "proj-A",
      resource_type: null,
      resource_id: null,
    });
  });

  it("derives session-chat = session_list_loaded (session_list + scope)", async () => {
    const sessions = [session("s1")];
    const { actor } = await arriveAtChat(sessions);
    const out = derived(actor, SESSION_CHAT, scListLoadedEvents(sessions));
    expect(out).toEqual(golden(SESSION_CHAT, scListLoadedEvents(sessions)));

    expect(out.state).toBe("session_list_loaded");
    expect(out.context.session_list).toEqual(sessions);
    expect(out.active_scope).toEqual({
      org_id: "org-acme",
      project_id: "proj-A",
      resource_type: null,
      resource_id: null,
    });
  });
});

// ═════════════════════════ Scenario 2 — needs_org (new user) ═════════════════════════

describe("R1 — login-and-org-setup = needs_org (new user, child live)", () => {
  it("derives needs_org with the user populated and empty scope", async () => {
    const rec = recorder();
    const actor = createActor(createChatApp(makeDeps(rec, [session("s1")])), {
      input: makeInput({ newUser: true }),
    }).start();
    await waitFor(actor, (a) => childState(a, "session-onboarding") === "needs_org");

    const log = [
      ev(LOGIN_LOG, "session_started", {
        user: {
          email: PROFILE.email,
          display_name: PROFILE.name,
          first_name: "Maya",
        },
        org: null,
      }),
    ];
    const out = derived(actor, LOGIN_AND_ORG_SETUP, log);
    expect(out).toEqual(golden(LOGIN_AND_ORG_SETUP, log));
    expect(out.state).toBe("needs_org");
    expect(out.context.org).toEqual({ id: null, name: null });
    expect(out.active_scope.org_id).toBe("");
  });
});

// ═════════════════ Scenario 3 — error_recoverable + underlying_cause_tag (auth-proxy literal) ═════════════════

describe("R1 — login-and-org-setup = error_recoverable (silent-reauth-failed)", () => {
  it("pins the auth-proxy literal: state=error_recoverable + context.underlying_cause_tag", async () => {
    const rec = recorder();
    const actor = createActor(createChatApp(makeDeps(rec, [session("s1")])), {
      input: makeInput({ newUser: true }),
    }).start();
    await waitFor(actor, (a) => childState(a, "session-onboarding") === "needs_org");

    // Drive the onboarding child to error_recoverable carrying the cause the
    // auth-proxy KPI sniffer keys off (the harness side-channel, child-direct).
    childRef(actor, "session-onboarding")!.send({
      type: "__force_failure__",
      tag: "silent-reauth-failed",
    });
    await waitFor(actor, (a) => childState(a, "session-onboarding") === "error_recoverable");

    const log = [
      ev(LOGIN_LOG, "session_started", {
        user: {
          email: PROFILE.email,
          display_name: PROFILE.name,
          first_name: "Maya",
        },
        org: null,
      }),
      ev(LOGIN_LOG, "reissue_failed_partial", {
        underlying_cause_tag: "silent-reauth-failed",
      }),
    ];
    const out = derived(actor, LOGIN_AND_ORG_SETUP, log);
    expect(out).toEqual(golden(LOGIN_AND_ORG_SETUP, log));
    expect(out.state).toBe("error_recoverable");
    expect(out.context.underlying_cause_tag).toBe("silent-reauth-failed");
  });
});

// ═════════════════════════ Scenario 4 — switching_project (transient) ═════════════════════════

describe("R1 — project-and-chat-session-management = switching_project", () => {
  it("derives switching_project (project preserved, deeplink target staged)", async () => {
    const slow = deferredSwitch("proj-B");
    const { actor } = await arriveAtChat([session("s1")], slow);

    actor.send({ type: "PROJECT_SWITCH", new_project_id: "proj-B" });
    await waitFor(actor, (a) => childState(a, "project-context") === "switching_project");

    const log = [
      ...pcSelectedEvents(),
      ev(PC_LOG, "switching_project_started", {
        org_id: ORG.id,
        deeplink_project_id: "proj-B",
      }),
    ];
    const out = derived(actor, PROJECT_AND_CHAT_SESSION_MANAGEMENT, log);
    expect(out).toEqual(golden(PROJECT_AND_CHAT_SESSION_MANAGEMENT, log));
    expect(out.state).toBe("switching_project");
    expect(out.context.project).toEqual({ id: "proj-A", name: "Project A" });
    expect(out.context.deeplink_project_id).toBe("proj-B");

    slow.resolve(); // settle the held invoke so the actor can stop cleanly
  });
});

// ═════════════════════════ Scenario 5 — session_active (resume) ═════════════════════════

describe("R1 — session-chat = session_active (resumed)", () => {
  it("derives session_active (session_id, transcript, scope)", async () => {
    const sessions = [session("s1")];
    const { actor } = await arriveAtChat(sessions);

    actor.send({ type: "user_intent", intent: { type: "session_clicked", session_id: "s1" } satisfies ChatUserIntent });
    await waitFor(actor, (a) => childState(a, "session-chat") === "session_active");

    const log = [
      ...scListLoadedEvents(sessions),
      ev(SC_LOG, "session_resume_started", { session_id: "s1" }),
      ev(SC_LOG, "session_resumed", {
        session_id: "s1",
        transcript: [],
        resource_type: null,
        resource_id: null,
        dataset_unavailable: false,
      }),
    ];
    const out = derived(actor, SESSION_CHAT, log);
    expect(out).toEqual(golden(SESSION_CHAT, log));
    expect(out.state).toBe("session_active");
    expect(out.context.session_id).toBe("s1");
  });
});

// ═════════════════════════ Scenario 6 — freeze overlay (all three) ═════════════════════════

describe("R1 — freeze overlay (connectivity frozen)", () => {
  it("login = expired_token, project + session-chat = freeze, byte-identical to the *_frozen fold", async () => {
    const sessions = [session("s1")];
    const { actor } = await arriveAtChat(sessions);
    actor.send({ type: "TOKEN_EXPIRED" });
    expect((actor.getSnapshot().value as { connectivity: string }).connectivity).toBe("frozen");

    // login-and-org-setup → expired_token (child stopped; retained outcome).
    const loginLog = [...loginReadyEvents(), ev(LOGIN_LOG, "token_expired")];
    const loginOut = derived(actor, LOGIN_AND_ORG_SETUP, loginLog);
    expect(loginOut).toEqual(golden(LOGIN_AND_ORG_SETUP, loginLog));
    expect(loginOut.state).toBe("expired_token");

    // project-and-chat-session-management → freeze (last_live_state preserved).
    const pcLog = [
      ...pcSelectedEvents(),
      ev(PC_LOG, "project_context_frozen", { last_live_state: "project_selected" }),
    ];
    const pcOut = derived(actor, PROJECT_AND_CHAT_SESSION_MANAGEMENT, pcLog);
    expect(pcOut).toEqual(golden(PROJECT_AND_CHAT_SESSION_MANAGEMENT, pcLog));
    expect(pcOut.state).toBe("freeze");
    expect(pcOut.context.last_live_state).toBe("project_selected");

    // session-chat → freeze (session_list preserved under the overlay).
    const scLog = [
      ...scListLoadedEvents(sessions),
      ev(SC_LOG, "session_chat_frozen", { last_live_state: "session_list_loaded" }),
    ];
    const scOut = derived(actor, SESSION_CHAT, scLog);
    expect(scOut).toEqual(golden(SESSION_CHAT, scLog));
    expect(scOut.state).toBe("freeze");
    expect(scOut.context.last_live_state).toBe("session_list_loaded");
  });
});

// ═════════════════════════ Scenario 7 — session_rejected (re-verify failure) ═════════════════════════

describe("R1 — login-and-org-setup = session_rejected (re-verify failed)", () => {
  it("derives session_rejected with the cause, after the onboarding child is stopped", async () => {
    const rec = recorder();
    const actor = createActor(createChatApp(makeDeps(rec, [session("s1")])), {
      input: makeInput({ badToken: true }),
    }).start();
    await waitFor(actor, (a) => lifecycle(a) === "user_rejected");
    expect(childRef(actor, "session-onboarding")).toBeUndefined();

    // The 401 re-verify throw is untagged → causeOf defaults to "transient".
    const log = [ev(LOGIN_LOG, "session_rejected", { reason: "transient" })];
    const out = derived(actor, LOGIN_AND_ORG_SETUP, log);
    expect(out).toEqual(golden(LOGIN_AND_ORG_SETUP, log));
    expect(out.state).toBe("session_rejected");
    expect(out.context.underlying_cause_tag).toBe("transient");
  });
});

// ═════════════════════════ flow_id synthesis + alias resolution + unknown machine ═════════════════════════

describe("R1 — flow_id synthesis, alias resolution, unknown machine", () => {
  it("synthesizes flow_id verbatim as {wireMachine}:{principal}", async () => {
    const { actor } = await arriveAtChat();
    expect(derived(actor, LOGIN_AND_ORG_SETUP, loginReadyEvents()).flow_id).toBe(
      "login-and-org-setup:dev-user-001",
    );
    expect(
      derived(actor, PROJECT_AND_CHAT_SESSION_MANAGEMENT, pcSelectedEvents()).flow_id,
    ).toBe("project-and-chat-session-management:dev-user-001");
  });

  it("resolves the canonical session-onboarding alias to the same child slice", async () => {
    const { actor } = await arriveAtChat();
    const out = deriveProjection(view(actor), "session-onboarding", bookkeepingFromLog(loginReadyEvents()));
    expect(out.state).toBe("ready");
    expect(out.flow_id).toBe("session-onboarding:dev-user-001");
  });

  it("throws on an unknown wire machine name", async () => {
    const { actor } = await arriveAtChat();
    expect(() =>
      deriveProjection(view(actor), "not-a-machine", { sequence_id: 0, last_event_at: "", request_id: "" }),
    ).toThrow(/unknown wire machine/i);
  });
});
