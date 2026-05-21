// Inner-contract regression for US-209 / MR-5 — the J-002 session-chat
// `switching_dataset_context` state must settle end-to-end through the
// orchestrator's emission path, exactly as D-MR4-06 established for
// project-context's `switching_project`.
//
// The acceptance probes read the PROJECTION (the event-sourced read model),
// not the live XState snapshot. So it is not enough for the machine to reach
// `session_active` with the new resource on its context — the orchestrator
// MUST (a) await the `switchDatasetContext` invoke (waitForSettledState now
// lists `switching_dataset_context` as transient) and (b) append the
// terminal `switching_dataset_context_started` + `dataset_attached` /
// `dataset_access_denied` FlowEvents sourced from the harvested settled
// context (the resolved resource lands on ctx AFTER the snapshot flips —
// the D-MR4-06 problem #2). Omitting either regresses the documented
// D-MR4-06 failure class onto the dataset path.
//
// Port-to-port: the test enters through the FlowOrchestrator's public
// surface (`beginIfNotStarted`, `send`, `getProjection`) and observes via
// the projection + the event log — the same SSOT the acceptance suite reads.

import { describe, expect, it } from "vitest";
import { fromPromise } from "xstate";

import { type Result } from "./flow-result.ts";
import {
  createSessionChatMachine,
  type LoadSessionListActor,
  type LoadSessionListInput,
  type LoadSessionListOutput,
  type ResumeSessionActor,
  type ResumeSessionInput,
  type ResumeSessionOutput,
  type SwitchDatasetContextActor,
  type SwitchDatasetContextInput,
  type SwitchDatasetContextOutput,
} from "./machines/session-chat/index.ts";
import { FlowActorRegistry, FlowOrchestrator } from "./orchestrator.ts";
import type { FlowEventLog } from "./persistence/redis.ts";
import type { FlowEvent } from "./projection.ts";

const WIRE = "session-chat";
const PRINCIPAL = "dev-user-001";
const FLOW_ID = `${WIRE}:${PRINCIPAL}`;

function createInMemoryFlowEventLog(): FlowEventLog & {
  dump(): Map<string, FlowEvent[]>;
} {
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
    dump: () => streams,
  };
}

const SESSION_ID = "sess-q4";

function sessionChatDeps(
  switchDatasetContext: SwitchDatasetContextActor,
  priorDatasetId: string | null = null,
) {
  const loadSessionList: LoadSessionListActor = fromPromise<
    LoadSessionListOutput,
    LoadSessionListInput
  >(async ({ input }) => ({
    items: [
      {
        id: SESSION_ID,
        title: "Q4 chat",
        last_active_at: "2026-05-15T10:00:00Z",
        active_dataset_id: priorDatasetId,
      },
    ],
    next_cursor: null,
    has_more: false,
    resume_target: input.pending_resume_session_id ?? null,
  }));
  const resumeSession: ResumeSessionActor = fromPromise<
    ResumeSessionOutput,
    ResumeSessionInput
  >(async () => ({
    session_id: SESSION_ID,
    transcript: [],
    active_dataset_id: priorDatasetId,
  }));
  return {
    deps: {
      loadSessionList,
      resumeSession,
      switchDatasetContext,
    },
    // Force the machine factory to use these deps.
    build: () =>
      createSessionChatMachine({
        loadSessionList,
        resumeSession,
        switchDatasetContext,
      }),
  };
}

async function buildSessionActiveFlow(
  switchDatasetContext: SwitchDatasetContextActor,
  priorDatasetId: string | null = null,
): Promise<{
  orch: FlowOrchestrator;
  log: ReturnType<typeof createInMemoryFlowEventLog>;
}> {
  const log = createInMemoryFlowEventLog();
  const { deps } = sessionChatDeps(switchDatasetContext, priorDatasetId);
  const orch = new FlowOrchestrator(
    {
      eventLog: log,
      sessionChatMachineDeps: deps,
      log: () => {},
    },
    new FlowActorRegistry(),
  );
  // project_ready dispatch → spawns session-chat, settles in
  // session_list_loaded.
  unwrap(
    await orch.beginIfNotStarted({
      machine: WIRE,
      principal_id: PRINCIPAL,
      correlation_id: "R-spawn",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
    }),
  );
  // Resume the session → session_active.
  const resumed = unwrap(
    await orch.send({
      machine: WIRE,
      flow_id: FLOW_ID,
      type: "session_clicked",
      payload: { session_id: SESSION_ID },
      correlation_id: "R-resume",
    }),
  );
  expect(resumed.state).toBe("session_active");
  return { orch, log };
}

// The orchestrator's public API returns Result; these tests assert the
// settled projection, so unwrap (a failure throws — same loud signal the
// prior throwing API gave).
function unwrap<T>(r: Result<T>): T {
  if (!r.ok)
    throw new Error(`expected ok Result, got ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("FlowOrchestrator — switching_dataset_context settles end-to-end (US-209)", () => {
  it("dataset_resolved_by_agent settles into session_active with active_scope.resource_* set", async () => {
    const switchDatasetContext: SwitchDatasetContextActor = fromPromise<
      SwitchDatasetContextOutput,
      SwitchDatasetContextInput
    >(async ({ input }) => {
      await new Promise((r) => setTimeout(r, 5));
      return {
        resource_type: "dataset",
        resource_id: input.intended_resource_id,
        persisted: true,
      };
    });
    const { orch, log } = await buildSessionActiveFlow(switchDatasetContext);

    const projection = unwrap(
      await orch.send({
        machine: WIRE,
        flow_id: FLOW_ID,
        type: "dataset_resolved_by_agent",
        payload: { resource_id: "ds-patients-2025", resource_type: "dataset" },
        correlation_id: "R-attach",
      }),
    );

    // The send() response already reflects the settled switch — the
    // acceptance probe reads exactly this projection.
    expect(projection.state).toBe("session_active");
    expect(projection.active_scope.resource_type).toBe("dataset");
    expect(projection.active_scope.resource_id).toBe("ds-patients-2025");

    // A re-read built from the event-log SSOT must agree (proves the
    // settle was persisted as FlowEvents, not observed transiently).
    const reread = unwrap(await orch.getProjection(FLOW_ID));
    expect(reread.active_scope.resource_id).toBe("ds-patients-2025");

    const types = (log.dump().get(FLOW_ID) ?? []).map((e) => e.type);
    expect(types).toContain("switching_dataset_context_started");
    expect(types).toContain("dataset_attached");

    await orch.dispose();
  });

  it("cross-tenant pick (dataset_access_denied) settles back to session_active with prior resource preserved", async () => {
    const switchDatasetContext: SwitchDatasetContextActor = fromPromise<
      SwitchDatasetContextOutput,
      SwitchDatasetContextInput
    >(async ({ input }) => {
      await new Promise((r) => setTimeout(r, 5));
      return {
        dataset_access_denied: true,
        prior_resource: input.prior_resource,
      };
    });
    // Prior dataset already attached on resume.
    const { orch, log } = await buildSessionActiveFlow(
      switchDatasetContext,
      "ds-sales-2026",
    );
    const before = unwrap(await orch.getProjection(FLOW_ID));
    expect(before.active_scope.resource_id).toBe("ds-sales-2026");

    const projection = unwrap(
      await orch.send({
        machine: WIRE,
        flow_id: FLOW_ID,
        type: "dataset_picked_directly",
        payload: { resource_id: "ds-restricted", resource_type: "dataset" },
        correlation_id: "R-denied",
      }),
    );

    expect(projection.state).toBe("session_active");
    // Prior scope preserved — the rejected pick did NOT retarget.
    expect(projection.active_scope.resource_id).toBe("ds-sales-2026");
    expect(
      (projection.context as { underlying_cause_tag: string })
        .underlying_cause_tag,
    ).toBe("dataset_access_denied");

    const types = (log.dump().get(FLOW_ID) ?? []).map((e) => e.type);
    expect(types).toContain("switching_dataset_context_started");
    expect(types).toContain("dataset_access_denied");
    expect(types).not.toContain("dataset_attached");

    await orch.dispose();
  });
});
