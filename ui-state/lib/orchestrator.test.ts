// Unit tests for the cross-machine FREEZE/THAW broadcast on FlowOrchestrator.
// Step 03-01 implements the architectural payoff of ADR-028 (XState v5 actor
// model): the orchestrator is the supervisor that owns the freeze/thaw signal
// and the replay buffer. Per ADR-028 §"Decision outcome":
//
//   1. One root orchestrator actor per process.
//   2. No machine imports another machine.
//   3. Replay buffer is a property of the orchestrator, not any machine.
//   4. Actor identity is (flow_id, principal_id).
//
// Behavior budget for this file:
//   B1 — broadcastFreeze marks all actors EXCEPT the origin as frozen.
//   B2 — broadcastThaw unfreezes and replays queued intent events.
//   B3 — events sent to a frozen flow are queued in the replay buffer.
//   B4 — 5s freeze window: events arriving after window are dropped.
//   B5 — 16-event cap: 17th event in window triggers abandonment.
//
// 5 behaviors × 2 = 10 max. Port-to-port: every test enters through the
// FlowOrchestrator's public surface (begin, send, broadcastFreeze,
// broadcastThaw, isFrozen) and observes via the projection or those methods.
//
// The session-onboarding actors are driven by a MOCK `fetch` injected as the I/O
// port (deps.request_client) — threaded through the BeginFlowInput.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromPromise } from "xstate";

import { FlowEvent, FlowId } from "./domain/flow-event.ts";
import type {
  CreateProjectActor,
  ProjectContextMachineDeps,
  ResolveInitialScopeActor,
  ResolveInitialScopeInput,
  ResolveInitialScopeOutput,
  SwitchProjectActor,
  SwitchProjectOutput,
} from "./machines/project-context/index.ts";
import type { RequestClient } from "./machines/session-onboarding/index.ts";
import { SessionOnboardingBeginStrategy } from "./machines/session-onboarding/strategy.ts";
import {
  BeginFlowOrchestrator,
  FlowActorRegistry,
  FlowOrchestrator,
} from "./orchestrator.ts";
import { createNoopFlowEventLog } from "./persistence/redis.ts";
import { makeMockFetch, makeTestConfig } from "./testing/test-config.ts";

const PROFILE_MAYA = {
  email: "maya.chen@acme-data.example",
  name: "Maya Chen",
};
const PROFILE_KAI = {
  email: "kai.lee@acme-data.example",
  name: "Kai Lee",
};

const CONFIG = makeTestConfig();

/** Mock fetch for a NEW user — re-verify OK, backend /api/orgs/me 404 (no org),
 *  create/reissue OK. */
function okFetch(profile = PROFILE_MAYA): RequestClient {
  return makeMockFetch({ profile });
}

/** Mock fetch for a RETURNING user — backend /api/orgs/me reports an org. */
function returningFetch(
  org: { id: string; name: string },
  profile = PROFILE_MAYA,
): RequestClient {
  return makeMockFetch({ profile, existingOrg: org });
}

function buildOrchestrator(): FlowOrchestrator {
  return new FlowOrchestrator(
    {
      eventLog: createNoopFlowEventLog(),
      log: () => {},
    },
    new FlowActorRegistry(),
  );
}

async function driveToReady(
  orch: FlowOrchestrator,
  principal: string,
  requestId: string,
  profile = PROFILE_MAYA,
  options: {
    requestClient?: RequestClient;
  } = {},
): Promise<{ flow_id: string }> {
  const beginOrchestrator = new BeginFlowOrchestrator(
    orch.deps.eventLog,
    orch.registry,
  );
  const strategy = new SessionOnboardingBeginStrategy(
    {
      flowId: FlowId.of("session-onboarding", principal),
      bearer_token: `tok-${principal}`,
      request_id: requestId,
      config: CONFIG,
      deps: { request_client: options.requestClient ?? okFetch(profile) },
    },
    orch.deps.eventLog,
    () => {},
  );
  await beginOrchestrator.begin(strategy);
  const flow_id = `session-onboarding:${principal}`;
  await orch.send(
    FlowEvent.createForFlow(flow_id, {
      type: "org_form_submitted",
      payload: { org_name: "Acme Data" },
      request_id: requestId,
    }),
  );
  return { flow_id };
}

describe("FlowOrchestrator.broadcastFreeze (B1)", () => {
  let orch: FlowOrchestrator;
  afterEach(async () => {
    await orch.dispose();
  });

  it("marks every actor as frozen EXCEPT the origin flow", async () => {
    orch = buildOrchestrator();
    const { flow_id: mayaFlow } = await driveToReady(orch, "user_maya", "R-1");
    const { flow_id: kaiFlow } = await driveToReady(
      orch,
      "user_kai",
      "R-2",
      PROFILE_KAI,
    );

    // Maya's flow is the designated freeze origin, broadcast directly via the
    // orchestrator's freeze entry point (the /freeze endpoint post-ADR-043 — no
    // machine reaches expired_token any more).
    orch.broadcastFreeze(mayaFlow);

    expect(orch.isFrozen(mayaFlow)).toBe(false);
    expect(orch.isFrozen(kaiFlow)).toBe(true);
  });
});

describe("FlowOrchestrator.broadcastThaw (B2)", () => {
  let orch: FlowOrchestrator;
  afterEach(async () => {
    await orch.dispose();
  });

  it("clears frozen state on every non-origin actor", async () => {
    orch = buildOrchestrator();
    const { flow_id: mayaFlow } = await driveToReady(orch, "user_maya", "R-1");
    const { flow_id: kaiFlow } = await driveToReady(
      orch,
      "user_kai",
      "R-2",
      PROFILE_KAI,
    );

    orch.broadcastFreeze(mayaFlow);
    expect(orch.isFrozen(kaiFlow)).toBe(true);

    await orch.broadcastThaw(mayaFlow);
    expect(orch.isFrozen(kaiFlow)).toBe(false);
  });
});

describe("FlowOrchestrator replay buffer (B3 + B5)", () => {
  let orch: FlowOrchestrator;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await orch.dispose();
  });

  it("queues intent events sent to a frozen flow and replays them on thaw", async () => {
    orch = buildOrchestrator();
    const { flow_id: mayaFlow } = await driveToReady(orch, "user_maya", "R-1");
    const { flow_id: kaiFlow } = await driveToReady(
      orch,
      "user_kai",
      "R-2",
      PROFILE_KAI,
    );

    orch.broadcastFreeze(mayaFlow);

    // Send three intent events to Kai while frozen.
    await orch.send(
      FlowEvent.createForFlow(kaiFlow, {
        type: "retry_clicked",
        payload: {},
        request_id: "R-2",
      }),
    );
    await orch.send(
      FlowEvent.createForFlow(kaiFlow, {
        type: "retry_clicked",
        payload: {},
        request_id: "R-2",
      }),
    );
    await orch.send(
      FlowEvent.createForFlow(kaiFlow, {
        type: "retry_clicked",
        payload: {},
        request_id: "R-2",
      }),
    );

    expect(orch.replayBufferSize(kaiFlow)).toBe(3);

    // Thawing replays queued events; buffer drains.
    await orch.broadcastThaw(mayaFlow);
    expect(orch.replayBufferSize(kaiFlow)).toBe(0);
  });

  it("abandons replay when the 17th queued event arrives during a single freeze window", async () => {
    orch = buildOrchestrator();
    const { flow_id: mayaFlow } = await driveToReady(orch, "user_maya", "R-1");
    const { flow_id: kaiFlow } = await driveToReady(
      orch,
      "user_kai",
      "R-2",
      PROFILE_KAI,
    );

    orch.broadcastFreeze(mayaFlow);

    // Push exactly 16 events — at the cap, still queued.
    for (let i = 0; i < 16; i += 1) {
      await orch.send(
        FlowEvent.createForFlow(kaiFlow, {
          type: "retry_clicked",
          payload: { i },
          request_id: "R-2",
        }),
      );
    }
    expect(orch.replayBufferSize(kaiFlow)).toBe(16);
    expect(orch.isAbandoned(kaiFlow)).toBe(false);

    // 17th event triggers overflow — buffer abandoned, future replay is a no-op.
    await orch.send(
      FlowEvent.createForFlow(kaiFlow, {
        type: "retry_clicked",
        payload: { i: 16 },
        request_id: "R-2",
      }),
    );
    expect(orch.isAbandoned(kaiFlow)).toBe(true);
  });
});

describe("FlowOrchestrator replay buffer 5s timeout (B4)", () => {
  let orch: FlowOrchestrator;
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await orch.dispose();
  });

  it("drops events arriving after the 5-second freeze window", async () => {
    orch = buildOrchestrator();
    const { flow_id: mayaFlow } = await driveToReady(orch, "user_maya", "R-1");
    const { flow_id: kaiFlow } = await driveToReady(
      orch,
      "user_kai",
      "R-2",
      PROFILE_KAI,
    );

    orch.broadcastFreeze(mayaFlow);
    // One event in-window — queued.
    await orch.send(
      FlowEvent.createForFlow(kaiFlow, {
        type: "retry_clicked",
        payload: {},
        request_id: "R-2",
      }),
    );
    expect(orch.replayBufferSize(kaiFlow)).toBe(1);

    // Advance past 5 seconds.
    await vi.advanceTimersByTimeAsync(5_001);

    // Post-window event is dropped (not added to buffer).
    await orch.send(
      FlowEvent.createForFlow(kaiFlow, {
        type: "retry_clicked",
        payload: { late: true },
        request_id: "R-2",
      }),
    );
    expect(orch.replayBufferSize(kaiFlow)).toBe(1);
    expect(orch.isAbandoned(kaiFlow)).toBe(true);
  });
});

// ── FIX D2 — auth_ready broadcast fires on the [hasOrg] shortcut path ──────
// Event-model Spec-1 last bullet (ratified 2026-05-22): a RETURNING user who
// reaches `ready` directly from `verifying` (the [hasOrg] shortcut, NO
// creating_org predecessor) must ALSO spawn project-context via the auth_ready
// broadcast carrying { org_id, first_name }. This was previously unasserted.
//
// The broadcast is observed by its SIDE EFFECT — the spawned project-context
// flow. We wire projectContextMachineDeps with a spy on resolveInitialScope:
//   - the spy's captured `org_id` input proves the broadcast carried org_id;
//   - the spawned project-context projection's context.user.first_name proves
//     the broadcast carried first_name (the machine seeds it from auth_ready).
// Neither is a tautology — both are downstream effects of the broadcast firing.
const PROJECT_CONTEXT_WIRE = "project-and-chat-session-management";

describe("auth_ready broadcast on the [hasOrg] shortcut (FIX D2)", () => {
  let orch: FlowOrchestrator;
  afterEach(async () => {
    await orch.dispose();
  });

  it("verifying → ready (returning user, no creating_org) fires auth_ready with org_id + first_name", async () => {
    const seenScopeInputs: ResolveInitialScopeInput[] = [];
    const resolveInitialScope: ResolveInitialScopeActor = fromPromise(
      async ({
        input,
      }: {
        input: ResolveInitialScopeInput;
      }): Promise<ResolveInitialScopeOutput> => {
        seenScopeInputs.push(input);
        return { project: { id: "proj-A", name: "Project A" } };
      },
    );
    const createProject: CreateProjectActor = fromPromise(async () => ({
      id: "proj-A",
      name: "Project A",
    }));
    const switchProject: SwitchProjectActor = fromPromise(
      async (): Promise<SwitchProjectOutput> => ({
        project: { id: "proj-A", name: "Project A" },
      }),
    );
    const projectContextMachineDeps: ProjectContextMachineDeps = {
      resolveInitialScope,
      createProject,
      switchProject,
    };

    orch = new FlowOrchestrator(
      {
        eventLog: createNoopFlowEventLog(),
        projectContextMachineDeps,
        log: () => {},
      },
      new FlowActorRegistry(),
    );

    // Returning user: the backend (/api/orgs/me) reports an org, so begin lands
    // DIRECTLY in `ready` via the [hasOrg] shortcut (no creating_org, no
    // org_form_submitted).
    const principal = "user_returning";
    const requestId = "R-hasorg";
    const beginOrchestrator = new BeginFlowOrchestrator(
      orch.deps.eventLog,
      orch.registry,
    );
    const strategy = new SessionOnboardingBeginStrategy(
      {
        flowId: FlowId.of("session-onboarding", principal),
        bearer_token: "tok-returning",
        request_id: requestId,
        config: CONFIG,
        deps: {
          request_client: returningFetch({
            id: "org-returning",
            name: "Acme Data",
          }),
        },
      },
      orch.deps.eventLog,
      () => {},
    );
    const beginResult = await beginOrchestrator.begin(strategy);
    expect(beginResult.ok).toBe(true);
    const loginFlow = `session-onboarding:${principal}`;

    // Drive a settle through send() on the already-`ready` returning-user flow.
    // prior is unset → isFirstReady (`!prior`) AND the predecessor was
    // `verifying` (begin's only transition) → settle returns authReady → the
    // pump fires beginIfNotStarted(project-context). An unknown event keeps the
    // machine in `ready` so the settle observes the [hasOrg] ready arm.
    await orch.send(
      FlowEvent.createForFlow(loginFlow, {
        type: "noop_settle_trigger",
        payload: {},
        request_id: requestId,
      }),
    );

    // Side effect 1: the broadcast spawned project-context, and its
    // resolveInitialScope invoke ran with the org_id the broadcast carried.
    // (The machine fires the invoke on initial entry with org_id="" then
    // re-enters on the auth_ready event with the broadcast's org_id — so we
    // assert the broadcast value is among the captured inputs, not an exact
    // invoke count, which would couple to the spawn mechanism's internals.)
    expect(seenScopeInputs.map((i) => i.org_id)).toContain("org-returning");

    // Side effect 2: the spawned project-context projection carries the
    // first_name the broadcast forwarded (Maya Chen → "Maya").
    const pcProjection = await orch.getProjection(
      `${PROJECT_CONTEXT_WIRE}:${principal}`,
    );
    expect(pcProjection.ok).toBe(true);
    if (pcProjection.ok) {
      const ctx = pcProjection.value.context as {
        org: { id: string | null };
        user: { first_name: string | null };
      };
      expect(ctx.user.first_name).toBe("Maya");
      expect(ctx.org.id).toBe("org-returning");
    }
  });
});
