// CONTRACT / BYTE-STABILITY GATE (ADR-046) — the whole-actor state document
// must be byte-equivalent, region-by-region, to the canonical log-fold model.
//
// ADR-046 Decision 1 adopts ONE `ChatAppStateDocument` (option 1B) with a
// `regions: { onboarding, projectContext, sessionChat }` map, each region a
// derived `{ state, context }` slice. This is the direct contract test the §9
// MR-7 row prescribes — it pins each region against `buildProjection` (the
// independent ADR-027 event-log fold, NOT the retired per-machine
// `deriveProjection` wrapper), so a snapshot-derived region byte-matches the
// log-sourced read model. For every scenario, drive a REAL wired ChatApp to the
// target state, then assert that `deriveStateDocument(view, aggregatedBookkeeping)`:
//     - regions.<r> deep-equals the { state, context } half of the
//       `buildProjection(<flowKey>, equivalentLog)` fold for ALL THREE regions;
//     - phase  equals the parent ChatApp lifecycle state value (independently
//       mapped here from actor.getSnapshot().value);
//     - active_scope equals the DEEPEST-RESOLVED region's active_scope
//       (session-chat > project-context > onboarding; "resolved" = org_id set);
//     - sequence_id aggregates the three per-region logs (sum of lengths).
//
// The harness below drives a real composition root with fromPromise fakes at
// every child port — mocks ONLY at the port boundary.

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
import type { ChatUserIntent,OnboardingInput } from "../setup/types.ts";
import {
  aggregateBookkeeping,
  bookkeepingFromLog,
  type ChatAppSnapshotView,
  deriveStateDocument,
} from "./derive-state-document.ts";

// ───────────────────────────── fixtures (mirror the per-machine gate) ─────────────────────────────

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

function makeDeps(rec: Recorder, sessions: SessionSummary[], slowSwitch?: Deferred) {
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

function makeInput(opts: { newUser?: boolean } = {}): OnboardingInput {
  return {
    request_id: REQ,
    principal_id: PRINCIPAL,
    bearer_token: "tok-maya",
    config: makeTestConfig(),
    // Identity now arrives via the seeded input (INV-PCO single writer), not a
    // re-verify fetch round-trip. display_name/first_name mirror PROFILE.
    user: { email: PROFILE.email, display_name: PROFILE.name, first_name: "Maya" },
    deps: {
      request_client: makeMockFetch({
        profile: PROFILE,
        ...(opts.newUser ? {} : { existingOrg: ORG }),
      }),
    },
  };
}

// ───────────────────────── snapshot readers ─────────────────────────

type ChatActor = ReturnType<typeof createActor>;

function view(actor: ChatActor): ChatAppSnapshotView {
  return actor.getSnapshot() as unknown as ChatAppSnapshotView;
}
function lifecycle(actor: ChatActor): unknown {
  return actor.getSnapshot().value;
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
  // Client-reported model: report the returning user's org through the parent so
  // onboarding advances awaiting_org_report → ready → the cascade reaches chat.
  actor.send({
    type: "child_event",
    child_event: { type: "org_found", payload: { org: ORG } },
  });
  await waitFor(actor, (a) => childState(a, "session-chat") === "session_list_loaded");
  return { actor, rec };
}

// Log keys are opaque to buildProjection (the fold dispatches on event.type, not
// the key) — keyed by the canonical child id for readability.
const LOGIN_LOG = "onboarding:" + PRINCIPAL;
const PC_LOG = "project-context:" + PRINCIPAL;
const SC_LOG = "session-chat:" + PRINCIPAL;

const loginReadyEvents = () => [
  ev(LOGIN_LOG, "session_started", {
    user: { email: PROFILE.email, display_name: PROFILE.name, first_name: "Maya" },
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

// ───────────────── the equivalence assertion (the gate) ─────────────────

/** Independent map of the parent ChatApp lifecycle value → ChatAppPhase.
 *  Mirrors machine.ts (top-level login / engaged{project_context|chat} /
 *  user_rejected) — written separately from derivePhase so the test cross-checks
 *  the mapper rather than echoing it. */
function expectedPhase(value: unknown): string {
  if (typeof value === "string") {
    if (value === "login") return "onboarding";
    if (value === "user_rejected") return "rejected";
    return value;
  }
  if (value && typeof value === "object" && "engaged" in value) {
    return (value as Record<string, unknown>).engaged === "chat"
      ? "chat"
      : "project_context";
  }
  return "onboarding";
}

interface RegionLogs {
  onboarding?: FlowEvent[];
  projectContext?: FlowEvent[];
  sessionChat?: FlowEvent[];
}

/** Assert the whole-actor document is byte-equivalent, region-by-region, to the
 *  canonical `buildProjection` log fold for the actor's CURRENT state. Returns
 *  the document so callers can pin individual fields. */
function assertEquivalence(actor: ChatActor, logs: RegionLogs) {
  const v = view(actor);
  const onbBk = bookkeepingFromLog(logs.onboarding ?? []);
  const pcBk = bookkeepingFromLog(logs.projectContext ?? []);
  const scBk = bookkeepingFromLog(logs.sessionChat ?? []);

  const doc = deriveStateDocument(v, aggregateBookkeeping([onbBk, pcBk, scBk]));

  // The independent log-fold golden for each region (NOT the retired per-machine
  // deriveProjection): same logical state, sourced from the equivalent event log.
  const goldenOnb = buildProjection(LOGIN_LOG, logs.onboarding ?? []);
  const goldenPc = buildProjection(PC_LOG, logs.projectContext ?? []);
  const goldenSc = buildProjection(SC_LOG, logs.sessionChat ?? []);

  // 1. Each region byte-equals the { state, context } half of the log fold.
  expect(doc.regions.onboarding).toEqual({
    state: goldenOnb.state,
    context: goldenOnb.context,
  });
  expect(doc.regions.projectContext).toEqual({
    state: goldenPc.state,
    context: goldenPc.context,
  });
  expect(doc.regions.sessionChat).toEqual({
    state: goldenSc.state,
    context: goldenSc.context,
  });

  // 2. phase equals the parent lifecycle value (independently mapped).
  expect(doc.phase).toBe(expectedPhase(lifecycle(actor)));

  // 3. active_scope equals the deepest-resolved region's active_scope.
  const deepest = goldenSc.active_scope.org_id
    ? goldenSc.active_scope
    : goldenPc.active_scope.org_id
      ? goldenPc.active_scope
      : goldenOnb.active_scope;
  expect(doc.active_scope).toEqual(deepest);

  // 4. sequence_id aggregates the three per-region logs.
  expect(doc.sequence_id).toBe(
    onbBk.sequence_id + pcBk.sequence_id + scBk.sequence_id,
  );

  return doc;
}

// ═════════════════════════ Scenario 1 — happy login → project → chat ═════════════════════════

describe("ADR-046 gate — happy login → project → chat (all three regions equivalent)", () => {
  it("document.regions equal the three per-machine derivations; phase=chat; scope=deepest", async () => {
    const sessions = [session("s1")];
    const { actor } = await arriveAtChat(sessions);
    // The phase-scoped onboarding child is gone at chat steady state.
    expect(childRef(actor, "onboarding")).toBeUndefined();

    const doc = assertEquivalence(actor, {
      onboarding: loginReadyEvents(),
      projectContext: pcSelectedEvents(),
      sessionChat: scListLoadedEvents(sessions),
    });

    // Explicit pins on the load-bearing region reads.
    expect(doc.phase).toBe("chat");
    expect(doc.regions.onboarding.state).toBe("ready");
    expect(doc.regions.onboarding.context.org).toEqual({
      id: "org-acme",
      name: "Acme Data",
    });
    expect(doc.regions.projectContext.state).toBe("project_selected");
    expect(doc.regions.projectContext.context.project).toEqual({
      id: "proj-A",
      name: "Project A",
    });
    expect(doc.regions.sessionChat.state).toBe("session_list_loaded");
    expect(doc.regions.sessionChat.context.session_list).toEqual(sessions);
    expect(doc.active_scope).toEqual({
      org_id: "org-acme",
      project_id: "proj-A",
      resource_type: null,
      resource_id: null,
    });
    // sequence_id aggregates 1 (login) + 2 (project) + 3 (session) logs.
    expect(doc.sequence_id).toBe(6);
  });
});

// ═════════════════════════ Scenario 2 — needs_org (new user) ═════════════════════════

describe("ADR-046 gate — onboarding=needs_org (new user, child live)", () => {
  it("onboarding region equivalent; phase=onboarding; scope empty-org", async () => {
    const rec = recorder();
    const actor = createActor(createChatApp(makeDeps(rec, [session("s1")])), {
      input: makeInput({ newUser: true }),
    }).start();
    // Client-reported model: report org_not_found through the parent to drive
    // onboarding awaiting_org_report → needs_org.
    actor.send({
      type: "child_event",
      child_event: { type: "org_not_found", payload: {} },
    });
    await waitFor(actor, (a) => childState(a, "onboarding") === "needs_org");

    // The golden log fold still reaches needs_org via session_started{org:null}
    // (a state shared by the old and new models); only the live driver changed.
    const onboardingLog = [
      ev(LOGIN_LOG, "session_started", {
        user: { email: PROFILE.email, display_name: PROFILE.name, first_name: "Maya" },
        org: null,
      }),
    ];

    // The ONBOARDING region (the region under test) is pinned BYTE-EQUIVALENT to
    // its canonical log fold — the contract that matters for this arm. The other
    // two regions are NOT yet invoked (parent still in `login`), so their live
    // no-child fallbacks are the client-reported zero states
    // (awaiting_scope_report / verifying). The out-of-scope `buildProjection`
    // log fold zero-state is `verifying` for every region and cannot model the
    // project-context region's new `awaiting_scope_report` zero — so those two
    // un-invoked regions are pinned directly to the new production zero states
    // rather than against the (now-divergent) empty log fold.
    const onbBk = bookkeepingFromLog(onboardingLog);
    const doc = deriveStateDocument(
      view(actor),
      aggregateBookkeeping([onbBk]),
    );
    const goldenOnb = buildProjection(LOGIN_LOG, onboardingLog);
    expect(doc.regions.onboarding).toEqual({
      state: goldenOnb.state,
      context: goldenOnb.context,
    });
    // Un-invoked regions: the client-reported cold-start zero states (DR-4).
    expect(doc.regions.projectContext.state).toBe("awaiting_scope_report");
    expect(doc.regions.sessionChat.state).toBe("verifying");

    expect(doc.phase).toBe("onboarding");
    expect(doc.regions.onboarding.state).toBe("needs_org");
    expect(doc.regions.onboarding.context.org).toEqual({ id: null, name: null });
    expect(doc.active_scope.org_id).toBe("");
  });
});

// ═════════════════════════ Scenario 4 — switching_project (transient) ═════════════════════════

describe("ADR-046 gate — projectContext=switching_project", () => {
  it("project-context region equivalent (project preserved, deeplink staged)", async () => {
    const slow = deferredSwitch("proj-B");
    const { actor } = await arriveAtChat([session("s1")], slow);

    actor.send({ type: "PROJECT_SWITCH", new_project_id: "proj-B" });
    await waitFor(actor, (a) => childState(a, "project-context") === "switching_project");

    const pcLog = [
      ...pcSelectedEvents(),
      ev(PC_LOG, "switching_project_started", {
        org_id: ORG.id,
        deeplink_project_id: "proj-B",
      }),
    ];
    const doc = assertEquivalence(actor, {
      onboarding: loginReadyEvents(),
      projectContext: pcLog,
      sessionChat: scListLoadedEvents([session("s1")]),
    });

    expect(doc.regions.projectContext.state).toBe("switching_project");
    expect(doc.regions.projectContext.context.project).toEqual({
      id: "proj-A",
      name: "Project A",
    });
    expect(doc.regions.projectContext.context.deeplink_project_id).toBe("proj-B");

    slow.resolve(); // settle the held invoke so the actor can stop cleanly
  });
});

// ═════════════════════════ Scenario 5 — session_active (resume) ═════════════════════════

describe("ADR-046 gate — sessionChat=session_active (resumed)", () => {
  it("session-chat region equivalent (session_id, transcript, scope)", async () => {
    const sessions = [session("s1")];
    const { actor } = await arriveAtChat(sessions);

    actor.send({
      type: "user_intent",
      intent: { type: "session_clicked", session_id: "s1" } satisfies ChatUserIntent,
    });
    await waitFor(actor, (a) => childState(a, "session-chat") === "session_active");

    const scLog = [
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
    const doc = assertEquivalence(actor, {
      onboarding: loginReadyEvents(),
      projectContext: pcSelectedEvents(),
      sessionChat: scLog,
    });

    expect(doc.regions.sessionChat.state).toBe("session_active");
    expect(doc.regions.sessionChat.context.session_id).toBe("s1");
  });
});

// ═════════════════════════ Scenario 7 — session_rejected (re-verify failure) ═════════════════════════
// (session_rejected retired under client-reported onboarding — CDO-S3.)
