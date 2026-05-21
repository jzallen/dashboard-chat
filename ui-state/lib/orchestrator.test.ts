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
//   B6 — login machine reaching expired_token triggers broadcastFreeze.
//   B7 — login machine returning to ready triggers broadcastThaw of others.
//
// 7 behaviors × 2 = 14 max. Port-to-port: every test enters through the
// FlowOrchestrator's public surface (begin, send, broadcastFreeze,
// broadcastThaw, isFrozen) and observes via the projection or those methods.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fromPromise } from "xstate";

import type {
  CreateOrgAndReissueActor,
  CreateOrgAndReissueInput,
  CreateOrgAndReissueOutput,
  LoginMachineDeps,
  WorkOSUserInfoActor,
} from "./machines/login-and-org-setup/index.ts";
import { LoginBeginStrategy } from "./machines/login-and-org-setup/strategy.ts";
import { FlowOrchestrator } from "./orchestrator.ts";
import { createNoopFlowEventLog } from "./persistence/redis.ts";

const PROFILE_MAYA = {
  email: "maya.chen@acme-data.example",
  display_name: "Maya Chen",
};
const PROFILE_KAI = {
  email: "kai.lee@acme-data.example",
  display_name: "Kai Lee",
};

function workosOkProfile(p: typeof PROFILE_MAYA): WorkOSUserInfoActor {
  return fromPromise(async () => p);
}

function succeedingCreateOrg(): CreateOrgAndReissueActor {
  return fromPromise<CreateOrgAndReissueOutput, CreateOrgAndReissueInput>(
    async ({ input }) => ({
      org_id: `org-${input.org_name.toLowerCase().replace(/\s+/g, "-")}`,
      org_name: input.org_name,
    }),
  );
}

function buildDeps(profile = PROFILE_MAYA): LoginMachineDeps {
  return {
    workosUserInfo: workosOkProfile(profile),
    createOrgAndReissue: succeedingCreateOrg(),
  };
}

function buildOrchestrator(): FlowOrchestrator {
  return new FlowOrchestrator({
    eventLog: createNoopFlowEventLog(),
    log: () => {},
  });
}

async function driveToReady(
  orch: FlowOrchestrator,
  principal: string,
  correlation: string,
  profile = PROFILE_MAYA,
  deps: LoginMachineDeps = buildDeps(profile),
): Promise<{ flow_id: string }> {
  const strategy = new LoginBeginStrategy(
    {
      machine: "login-and-org-setup",
      principal_id: principal,
      persona_email: profile.email,
      persona_display_name: profile.display_name,
      correlation_id: correlation,
    },
    deps,
    orch.deps.eventLog,
    () => {},
  );
  await orch.begin(strategy);
  const flow_id = `login-and-org-setup:${principal}`;
  await orch.send({
    machine: "login-and-org-setup",
    flow_id,
    type: "org_form_submitted",
    payload: { org_name: "Acme Data" },
    correlation_id: correlation,
  });
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

    // Maya is the origin (her login machine reached expired_token).
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
    await orch.send({
      machine: "login-and-org-setup",
      flow_id: kaiFlow,
      type: "retry_clicked",
      payload: {},
      correlation_id: "R-2",
    });
    await orch.send({
      machine: "login-and-org-setup",
      flow_id: kaiFlow,
      type: "retry_clicked",
      payload: {},
      correlation_id: "R-2",
    });
    await orch.send({
      machine: "login-and-org-setup",
      flow_id: kaiFlow,
      type: "retry_clicked",
      payload: {},
      correlation_id: "R-2",
    });

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
      await orch.send({
        machine: "login-and-org-setup",
        flow_id: kaiFlow,
        type: "retry_clicked",
        payload: { i },
        correlation_id: "R-2",
      });
    }
    expect(orch.replayBufferSize(kaiFlow)).toBe(16);
    expect(orch.isAbandoned(kaiFlow)).toBe(false);

    // 17th event triggers overflow — buffer abandoned, future replay is a no-op.
    await orch.send({
      machine: "login-and-org-setup",
      flow_id: kaiFlow,
      type: "retry_clicked",
      payload: { i: 16 },
      correlation_id: "R-2",
    });
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
    await orch.send({
      machine: "login-and-org-setup",
      flow_id: kaiFlow,
      type: "retry_clicked",
      payload: {},
      correlation_id: "R-2",
    });
    expect(orch.replayBufferSize(kaiFlow)).toBe(1);

    // Advance past 5 seconds.
    await vi.advanceTimersByTimeAsync(5_001);

    // Post-window event is dropped (not added to buffer).
    await orch.send({
      machine: "login-and-org-setup",
      flow_id: kaiFlow,
      type: "retry_clicked",
      payload: { late: true },
      correlation_id: "R-2",
    });
    expect(orch.replayBufferSize(kaiFlow)).toBe(1);
    expect(orch.isAbandoned(kaiFlow)).toBe(true);
  });
});

describe("Login machine reaching expired_token triggers broadcastFreeze (B6)", () => {
  let orch: FlowOrchestrator;
  afterEach(async () => {
    await orch.dispose();
  });

  it("freezes all other actors when the login flow enters expired_token", async () => {
    process.env.NWAVE_HARNESS_KNOBS = "true";
    try {
      orch = buildOrchestrator();
      const { flow_id: mayaFlow } = await driveToReady(
        orch,
        "user_maya",
        "R-1",
      );
      const { flow_id: kaiFlow } = await driveToReady(
        orch,
        "user_kai",
        "R-2",
        PROFILE_KAI,
      );

      // Drive Maya into expired_token via the harness side-channel.
      await orch.send({
        machine: "login-and-org-setup",
        flow_id: mayaFlow,
        type: "__expire_token__",
        payload: {},
        correlation_id: "R-1",
      });

      // Maya is origin — not frozen. Kai is — frozen.
      expect(orch.isFrozen(mayaFlow)).toBe(false);
      expect(orch.isFrozen(kaiFlow)).toBe(true);
    } finally {
      delete process.env.NWAVE_HARNESS_KNOBS;
    }
  });
});

describe("Login machine returning to ready after silent reauth triggers broadcastThaw (B7)", () => {
  let orch: FlowOrchestrator;
  afterEach(async () => {
    await orch.dispose();
  });

  it("thaws other actors when the origin login flow returns to ready", async () => {
    process.env.NWAVE_HARNESS_KNOBS = "true";
    try {
      // Build deps with a silent reauth that succeeds on the first try.
      const silentReauthOk = fromPromise(async () => ({ ok: true as const }));
      const deps: LoginMachineDeps = {
        workosUserInfo: workosOkProfile(PROFILE_MAYA),
        createOrgAndReissue: succeedingCreateOrg(),
        silentReauth: silentReauthOk,
      } as unknown as LoginMachineDeps;
      orch = buildOrchestrator();

      // Maya is the origin flow that expires + silently reauths, so her begin
      // gets the silentReauth-wired deps; Kai never reaches expired_token.
      const { flow_id: mayaFlow } = await driveToReady(
        orch,
        "user_maya",
        "R-1",
        PROFILE_MAYA,
        deps,
      );
      const { flow_id: kaiFlow } = await driveToReady(
        orch,
        "user_kai",
        "R-2",
        PROFILE_KAI,
      );

      // Expire — should freeze Kai and invoke silent reauth which succeeds.
      await orch.send({
        machine: "login-and-org-setup",
        flow_id: mayaFlow,
        type: "__expire_token__",
        payload: {},
        correlation_id: "R-1",
      });

      // Kai is no longer frozen — Maya's machine returned to ready.
      expect(orch.isFrozen(kaiFlow)).toBe(false);
    } finally {
      delete process.env.NWAVE_HARNESS_KNOBS;
    }
  });
});
