// Unit tests for the ProjectContext (J-002 project half) XState machine.
//
// CLIENT-REPORT-DRIVEN model (ADR-049 §3 / ADR-050 §f, slice CDO-S1). The
// machine no longer invokes a server-side resolver — it settles in
// `awaiting_scope_report` (no invoke) and advances on CLIENT REPORTS:
//
//   awaiting_scope_report on scope_resolved   → project_selected (assign {id,name})
//   awaiting_scope_report on project_created  → project_selected (assign {id,name})
//   awaiting_scope_report on no_projects_found → no_projects
//   no_projects           on project_created  → project_selected (Phase D from
//                                                either state)
//
// US-207 switching_project (switchProject invoke) + the scope_mismatch_terminal
// re-entry stay UNTOUCHED in S1 (CDO-S3 reworks the switch + deep-link
// discrimination). The deep-link wish-capture (`open_deep_link`, kept per
// ADR-049 §3) re-enters awaiting_scope_report carrying the wish; the
// cross_tenant / project_not_found DISCRIMINATION of that wish becomes a client
// `scope_mismatch` report in CDO-S3 (not modeled here).
//
// All tests are port-to-port at the machine's driving port (XState actor's
// public `send` / snapshot surface). No internal-class assertions.

import { describe, expect, it } from "vitest";
import { createActor, fromPromise } from "xstate";

import {
  createProjectContextMachine,
  type ProjectSummary,
  type SwitchProjectActor,
  type SwitchProjectOutput,
} from "./index.ts";

function switchTo(output: SwitchProjectOutput): SwitchProjectActor {
  return fromPromise(async () => output);
}

function switchFails(message: string): SwitchProjectActor {
  return fromPromise<SwitchProjectOutput, { new_project_id: string; request_id: string; principal_id: string }>(
    async () => {
      throw new Error(message);
    },
  );
}

const MAYA_INPUT = {
  request_id: "R-7a4f-901c",
  principal_id: "dev-user-001",
  org_id: "dev-org-001",
  user: { first_name: "Maya" },
};

async function waitFor(
  actor: ReturnType<typeof createActor>,
  predicate: (snapshot: ReturnType<typeof actor.getSnapshot>) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const initial = actor.getSnapshot();
    if (predicate(initial)) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      sub.unsubscribe();
      reject(new Error("waitFor: timeout"));
    }, timeoutMs);
    const sub = actor.subscribe((snap) => {
      if (predicate(snap)) {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve();
      }
    });
  });
}

/** Drive the cold-start machine into engaged: start + forward auth_ready (the
 *  parent does this on the advance to engaged), settling awaiting_scope_report. */
function startAwaiting(machine: ReturnType<typeof createProjectContextMachine>) {
  const actor = createActor(machine, { input: MAYA_INPUT });
  actor.start();
  actor.send({
    type: "auth_ready",
    org_id: "dev-org-001",
    user: { first_name: "Maya" },
  });
  return actor;
}

describe("ProjectContextMachine — report-driven scope (CDO-S1)", () => {
  it("cold-starts in awaiting_scope_report (no invoke) once auth_ready is forwarded", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    const ctx = actor.getSnapshot().context;
    // auth_ready seeded the inherited identity; no project resolved yet.
    expect(ctx.org_id).toBe("dev-org-001");
    expect(ctx.user.first_name).toBe("Maya");
    expect(ctx.project.id).toBeNull();
  });

  it("scope_resolved report from awaiting_scope_report settles project_selected with the reported project", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({
      type: "scope_resolved",
      project: { id: "proj-q4", name: "Q4 Analytics" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-q4");
    expect(ctx.project.name).toBe("Q4 Analytics");
  });

  it("no_projects_found report from awaiting_scope_report settles no_projects", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({ type: "no_projects_found" });
    await waitFor(actor, (s) => s.value === "no_projects");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("no_projects");
  });

  it("project_created report (Phase D) from awaiting_scope_report settles project_selected", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({
      type: "project_created",
      project: { id: "proj-new", name: "My First Project" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-new");
    expect(ctx.project.name).toBe("My First Project");
  });

  it("project_created report (Phase D) from no_projects settles project_selected", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({ type: "no_projects_found" });
    await waitFor(actor, (s) => s.value === "no_projects");
    actor.send({
      type: "project_created",
      project: { id: "proj-default", name: "My First Project" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-default");
    expect(ctx.project.name).toBe("My First Project");
  });
});

// ─────────────────── deep-link wish capture (open_deep_link kept; ADR-049 §3) ──────────────

describe("ProjectContextMachine — deep-link wish capture", () => {
  it("open_deep_link captures the wish into context.deeplink_* and re-enters awaiting_scope_report", async () => {
    // Under the report-driven model open_deep_link is pure wish-capture (no
    // server re-resolve). The cross_tenant / project_not_found discrimination
    // of that wish becomes a client `scope_mismatch` report — CDO-S3.
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");

    actor.send({
      type: "open_deep_link",
      intent_project_id: "deep-link-proj",
      intent_session_id: "sess-1",
      intent_resource_id: "ds-1",
      intent_resource_type: "dataset",
    });
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    const ctx = actor.getSnapshot().context;
    expect(ctx.deeplink_project_id).toBe("deep-link-proj");
    expect(ctx.deeplink_session_id).toBe("sess-1");
    // `intent_resource_id` / `intent_resource_type` are not materialized into
    // ctx: the orchestrator forwards them directly from the open_deep_link
    // event payload into the project_ready broadcast, without ever touching
    // this ctx.
  });
});

/** Drive the machine to project_selected on `initial` via a scope_resolved
 *  report (the report-driven arrange the switch tests share — the switch PATH
 *  itself is untouched in CDO-S1). */
async function startSelected(
  switchProject: SwitchProjectActor,
  initial: ProjectSummary = { id: "proj-A", name: "Project A" },
) {
  const actor = startAwaiting(createProjectContextMachine({ switchProject }));
  await waitFor(actor, (s) => s.value === "awaiting_scope_report");
  actor.send({ type: "scope_resolved", project: initial });
  await waitFor(actor, (s) => s.value === "project_selected");
  return actor;
}

describe("ProjectContextMachine — US-207 switching_project (MR-4)", () => {
  it("switching_project_intent moves project_selected → switching_project", async () => {
    const target: ProjectSummary = { id: "proj-B", name: "Project B" };
    const actor = await startSelected(switchTo({ project: target }));
    expect(actor.getSnapshot().context.project.id).toBe("proj-A");
    actor.send({
      type: "switching_project_intent",
      new_project_id: "proj-B",
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-B");
    expect(ctx.project.name).toBe("Project B");
    // After settle, deeplink_project_id should be cleared.
    expect(ctx.deeplink_project_id).toBeNull();
  });

  it("switchProject access_revoked → scope_mismatch_terminal with cause access_revoked", async () => {
    const actor = await startSelected(switchTo({ access_revoked: true }));
    actor.send({
      type: "switching_project_intent",
      new_project_id: "p-revoked",
    });
    await waitFor(actor, (s) => s.value === "scope_mismatch_terminal");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("access_revoked");
  });

  it("switchProject project_not_found → scope_mismatch_terminal", async () => {
    const actor = await startSelected(switchTo({ project_not_found: true }));
    actor.send({
      type: "switching_project_intent",
      new_project_id: "p-gone",
    });
    await waitFor(actor, (s) => s.value === "scope_mismatch_terminal");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("project_not_found");
  });

  it("switchProject transient failure → error_recoverable", async () => {
    const actor = await startSelected(switchFails("transient backend 500"));
    actor.send({
      type: "switching_project_intent",
      new_project_id: "p-flaky",
    });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("transient");
  });
});

// ─────────── CDO-S3 (03-02): project-creation failure is RECOVERABLE ──────────
//
// Spec 7b — Phase D project-creation failure is retryable (domain-model.md §5.1
// / §5.3). A lost-response project_create_failed lands the machine in
// error_recoverable; error_recoverable then ACCEPTS outcome reports directly —
// the client re-POSTs / re-probes and reports project_created or scope_resolved,
// converging on project_selected with NO dead-end, NO retry_clicked re-invoke.

describe("ProjectContextMachine — project_create_failed recovery (CDO-S3)", () => {
  it("project_create_failed from awaiting_scope_report → error_recoverable (cause carried)", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({
      type: "project_create_failed",
      cause: "project_create_failed",
    });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe(
      "project_create_failed",
    );
  });

  it("project_create_failed from no_projects → error_recoverable (cause carried)", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({ type: "no_projects_found" });
    await waitFor(actor, (s) => s.value === "no_projects");
    actor.send({
      type: "project_create_failed",
      cause: "project_create_failed",
    });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe(
      "project_create_failed",
    );
  });

  it("scope_resolved from error_recoverable → project_selected (Spec 7b probe-first convergence)", async () => {
    // Spec 7b: a lost-response create failed → error_recoverable; the client
    // re-probes GET /api/projects, finds the project the POST actually made, and
    // reports scope_resolved → project_selected (no duplicate).
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({
      type: "project_create_failed",
      cause: "project_create_failed",
    });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    actor.send({
      type: "scope_resolved",
      project: { id: "proj-1", name: "My First Project" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-1");
    expect(ctx.project.name).toBe("My First Project");
  });

  it("project_created from error_recoverable → project_selected", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({
      type: "project_create_failed",
      cause: "project_create_failed",
    });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    actor.send({
      type: "project_created",
      project: { id: "proj-retry", name: "My First Project" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-retry");
    expect(ctx.project.name).toBe("My First Project");
  });

  it("project_create_failed self-loops error_recoverable (cause refresh)", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({
      type: "project_create_failed",
      cause: "project_create_failed",
    });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    actor.send({
      type: "project_create_failed",
      cause: "project_create_failed",
    });
    // Stays put — a re-failed retry refreshes the cause without leaving the state.
    await waitFor(actor, (s) => s.value === "error_recoverable");
    expect(actor.getSnapshot().value).toBe("error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe(
      "project_create_failed",
    );
  });

  it("retry_clicked no longer transitions out of error_recoverable (ADR-049 §3.3 retired)", async () => {
    const actor = startAwaiting(createProjectContextMachine({}));
    await waitFor(actor, (s) => s.value === "awaiting_scope_report");
    actor.send({
      type: "project_create_failed",
      cause: "project_create_failed",
    });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    // retry_clicked is retired — sending it is a no-op (stays error_recoverable).
    actor.send({ type: "retry_clicked" } as never);
    expect(actor.getSnapshot().value).toBe("error_recoverable");
  });
});
