// Regression test for D-MR4-06 — the J-002 `switching_project` state never
// settles end-to-end.
//
// Symptom (surfaced by MR-4-verify): posting `switching_project_intent` to a
// project-context flow in `project_selected` moves the machine into
// `switching_project` and invokes the `switchProject` actor, but the
// projection (the event-sourced read model the acceptance probes observe)
// stays at `switching_project` indefinitely — `project_switched` /
// `project_selected` are never appended to the FlowEvent log.
//
// Root cause: `waitForSettledState()` omitted `switching_project` from its
// `TRANSIENT_STATES` set, so `send()` did not await the `switchProject`
// invoke. It read the snapshot while still in `switching_project`, emitted
// only `switching_project_started`, and returned — the later settle to
// `project_selected` was never observed, so no terminal projection event
// was emitted.
//
// Port-to-port: the test enters through the FlowOrchestrator's public
// surface (`beginIfNotStarted`, `send`, `getProjection`) and observes via
// the projection + the event log — the same SSOT the acceptance suite reads.

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

/** In-memory FlowEventLog — buildProjection reads from this exactly as the
 *  Redis tier would in production. */
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

function projectContextDeps(
  switchProject: SwitchProjectActor,
): ProjectContextMachineDeps {
  const resolveInitialScope: ResolveInitialScopeActor = fromPromise(
    async () => ({ project: { id: "proj-A", name: "Project A" } }),
  );
  return {
    resolveInitialScope,
    createProject: fromPromise(async () => ({
      id: "proj-A",
      name: "Project A",
    })),
    switchProject,
  };
}

async function buildSettledProjectContextFlow(
  switchProject: SwitchProjectActor,
): Promise<{
  orch: FlowOrchestrator;
  log: ReturnType<typeof createInMemoryFlowEventLog>;
}> {
  const log = createInMemoryFlowEventLog();
  const orch = new FlowOrchestrator(
    {
      eventLog: log,
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
  // Precondition: the flow settles in project_selected on project A.
  expect(initial.state).toBe("project_selected");
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

describe("FlowOrchestrator — switching_project settles end-to-end (D-MR4-06)", () => {
  it("settles switching_project_intent into project_selected on the new project", async () => {
    // switchProject resolves asynchronously (a real HTTP round-trip to
    // GET /api/projects/:id). The orchestrator MUST await this invoke.
    const switchProject: SwitchProjectActor = fromPromise(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { project: { id: "proj-B", name: "Project B" } };
    });
    const { orch, log } = await buildSettledProjectContextFlow(switchProject);

    const projection = unwrap(
      await orch.send({
        machine: WIRE,
        flow_id: FLOW_ID,
        type: "switching_project_intent",
        payload: { new_project_id: "proj-B" },
        request_id: "R-switch",
      }),
    );

    // The send() response must already reflect the settled switch — the
    // acceptance probe reads exactly this projection.
    expect(projection.state).toBe("project_selected");
    expect(projection.active_scope.project_id).toBe("proj-B");

    // And a re-read of the projection (built from the event log SSOT) must
    // agree — proving the settle was persisted as FlowEvents, not just
    // observed transiently on the actor.
    const reread = unwrap(await orch.getProjection(FLOW_ID));
    expect(reread.state).toBe("project_selected");
    expect((reread.context as { project: { id: string } }).project.id).toBe(
      "proj-B",
    );

    // D-MR4-04: the orchestrator emits BOTH project_selected AND
    // project_switched when settling out of switching_project.
    const events = log.dump().get(FLOW_ID) ?? [];
    const types = events.map((e) => e.type);
    expect(types).toContain("switching_project_started");
    expect(types).toContain("project_switched");

    await orch.dispose();
  });

  it("settles a revoked-project switch into scope_mismatch_terminal", async () => {
    const switchProject: SwitchProjectActor = fromPromise(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { access_revoked: true };
    });
    const { orch } = await buildSettledProjectContextFlow(switchProject);

    const projection = unwrap(
      await orch.send({
        machine: WIRE,
        flow_id: FLOW_ID,
        type: "switching_project_intent",
        payload: { new_project_id: "p-revoked" },
        request_id: "R-switch-revoked",
      }),
    );

    expect(projection.state).toBe("scope_mismatch_terminal");
    expect(
      (projection.context as { underlying_cause_tag: string })
        .underlying_cause_tag,
    ).toBe("access_revoked");

    await orch.dispose();
  });
});
