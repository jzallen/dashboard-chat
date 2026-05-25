// Characterization (R3) — freeze → queue → thaw → replay is transparent to
// the projection STATE + sequence_id.
//
// The FlowId/FlowEvent refactor tightens the frozen-queue path: today the
// frozen branch appends a queued event with one `ts`, and THAW replay
// rebuilds a SECOND event with a SECOND `ts`; after the change the queued
// event IS the replayed event, so the append + the replay share ONE arrival
// `ts`. Nothing sorts by `ts` (log order is the Redis stream id; replay
// order is `seq`; the projection copies `ts` to `last_event_at` but never
// sorts by it), so the observable projection — state + sequence_id — is
// UNCHANGED. This pins exactly that: a queued switching_project_intent
// replays to project_selected on the switched-to project, and the
// post-thaw projection state + sequence_id match concrete values that must
// survive the refactor.
//
// Per the design note R3: assert STATE + sequence_id, NOT exact `ts`
// (nondeterministic before AND after).
//
// Port-to-port: enters through beginIfNotStarted / send / broadcastFreeze /
// broadcastThaw / getProjection; observes via the projection + replay-buffer
// queries — the SSOT the acceptance suite reads.

import { describe, expect, it } from "vitest";
import { fromPromise } from "xstate";

import { type Result } from "./flow-result.ts";
import type {
  ProjectContextMachineDeps,
  ResolveInitialScopeActor,
  SwitchProjectActor,
} from "./machines/project-context/machine.ts";
import { FlowActorRegistry, FlowOrchestrator } from "./orchestrator.ts";
import type { FlowEventLog } from "./persistence/redis.ts";
import type { FlowEvent } from "./projection.ts";

const WIRE = "project-and-chat-session-management";
const PRINCIPAL = "dev-user-001";
const FLOW_ID = `${WIRE}:${PRINCIPAL}`;
// A freeze origin that is NOT in the actor map, so broadcastFreeze freezes
// every tracked flow (just FLOW_ID here).
const FAKE_ORIGIN = `${WIRE}:some-other-principal`;

function createInMemoryFlowEventLog(): FlowEventLog {
  const streams = new Map<string, FlowEvent[]>();
  return {
    async append(flow_id, event) {
      const arr = streams.get(flow_id) ?? [];
      arr.push(event);
      streams.set(flow_id, arr);
    },
    async read(flow_id) {
      return [...(streams.get(flow_id) ?? [])];
    },
    async reset(flow_id) {
      streams.delete(flow_id);
    },
    // eslint-disable-next-line require-yield
    async *subscribe() {
      return;
    },
    async probe() {},
    async close() {},
  };
}

function projectContextDeps(
  switchProject: SwitchProjectActor,
): ProjectContextMachineDeps {
  const resolveInitialScope: ResolveInitialScopeActor = fromPromise(
    async () => ({ project: { id: "proj-A", name: "Project A" } }),
  );
  return {
    resolveInitialScope,
    createProject: fromPromise(async () => ({ id: "proj-A", name: "Project A" })),
    switchProject,
  };
}

function unwrap<T>(r: Result<T>): T {
  if (!r.ok)
    throw new Error(`expected ok Result, got ${JSON.stringify(r.error)}`);
  return r.value;
}

async function buildSettledFlow(): Promise<FlowOrchestrator> {
  const switchProject: SwitchProjectActor = fromPromise(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return { project: { id: "proj-B", name: "Project B" } };
  });
  const orch = new FlowOrchestrator(
    {
      eventLog: createInMemoryFlowEventLog(),
      projectContextMachineDeps: projectContextDeps(switchProject),
      log: () => {},
    },
    new FlowActorRegistry(),
  );
  const initial = unwrap(
    await orch.beginIfNotStarted({
      machine: WIRE,
      principal_id: PRINCIPAL,
      request_id: "R-begin",
      org_id: "dev-org-001",
      user_first_name: "Dev",
    }),
  );
  expect(initial.state).toBe("project_selected");
  return orch;
}

describe("freeze → queue → thaw → replay transparency (R3 characterization)", () => {
  it("replays a queued switching_project_intent to project_selected on the switched-to project", async () => {
    const orch = await buildSettledFlow();

    // Freeze the project-context flow (origin is elsewhere, so FLOW_ID freezes).
    await orch.broadcastFreeze(FAKE_ORIGIN);
    expect(orch.isFrozen(FLOW_ID)).toBe(true);

    // A switch intent arrives WHILE frozen — queued in the replay buffer,
    // not dispatched to the actor yet.
    await orch.send({
      machine: WIRE,
      flow_id: FLOW_ID,
      type: "switching_project_intent",
      payload: { new_project_id: "proj-B" },
      request_id: "R-switch",
    });
    expect(orch.replayBufferSize(FLOW_ID)).toBe(1);

    // Thaw → pass-2 replays the queued intent through send(); the switch
    // settles on proj-B.
    await orch.broadcastThaw(FAKE_ORIGIN);
    expect(orch.isFrozen(FLOW_ID)).toBe(false);
    expect(orch.replayBufferSize(FLOW_ID)).toBe(0);

    const proj = unwrap(await orch.getProjection(FLOW_ID));
    // STATE — the replayed intent drove the switch to completion.
    expect(proj.state).toBe("project_selected");
    expect(proj.active_scope.project_id).toBe("proj-B");
    // sequence_id (= event count) is deterministic across the freeze/replay
    // path and unchanged by the ts-equality tightening. Pinned concretely so
    // the post-refactor run is provably byte-equivalent on the read shape.
    expect(proj.sequence_id).toBe(SETTLED_SEQUENCE_ID);

    await orch.dispose();
  });
});

// Pinned from the CURRENT code (pre-refactor). The freeze/thaw/replay path's
// event count is deterministic; the refactor changes only a replayed event's
// `ts` value, never the entry count, so this must hold identically after.
const SETTLED_SEQUENCE_ID = 9;
