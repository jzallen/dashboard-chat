// Unit tests for the ProjectContext (J-002 project half) XState machine.
//
// Behaviors covered (post-DWD-13 SRP split — lifted from
// `project-and-chat-session-management.test.ts` MR-1 budget):
//   B1 — resolveInitialScope → no_projects when backend returns empty.
//   B2 — resolveInitialScope → project_selected when backend returns ≥1 project.
//   B3 — creating_project → project_selected on success.
//   B4 — creating_project → error_recoverable on transient failure;
//         pending_project_name preserved for composer state.
//   B5 — empty project name (whitespace-only) keeps machine in
//         no_projects with inline validation error.
//
// US-204 deep-link behaviors (sub-step 01-03):
//   B6 — resolveInitialScope with deeplink_project_id + {cross_tenant: true}
//         → scope_mismatch_terminal with cause "cross_tenant".
//   B7 — resolveInitialScope with deeplink_project_id + {project_not_found: true}
//         → scope_mismatch_terminal with cause "project_not_found".
//   B8 — open_deep_link event re-enters resolving_initial_scope and assigns
//         context.deeplink_* from the event payload (the event payload keys
//         still use the legacy `intent_*` prefix — that's a deferred follow-up).
//   B9 — back_to_projects_clicked from scope_mismatch_terminal clears
//         context.deeplink_* and transitions to resolving_initial_scope.
//
// All tests are port-to-port at the machine's driving port (XState actor's
// public `send` / snapshot surface). No internal-class assertions.

import { describe, expect, it } from "vitest";
import { createActor, fromPromise } from "xstate";

import {
  createProjectContextMachine,
  type CreateProjectActor,
  type ProjectSummary,
  type ResolveInitialScopeActor,
  type ResolveInitialScopeOutput,
  type SwitchProjectActor,
  type SwitchProjectOutput,
} from "./machine.ts";

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

function resolveTo(output: ResolveInitialScopeOutput): ResolveInitialScopeActor {
  return fromPromise(async () => output);
}

function createProjectOk(summary: ProjectSummary): CreateProjectActor {
  return fromPromise(async () => summary);
}

function createProjectFails(message: string): CreateProjectActor {
  return fromPromise<ProjectSummary, { org_name: string; request_id: string; principal_id: string }>(
    async () => {
      throw new Error(message);
    },
  );
}

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

describe("ProjectContextMachine — substrate behaviors", () => {
  it("settles in no_projects when resolveInitialScope returns empty", async () => {
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ no_projects: true }),
      createProject: createProjectOk({ id: "p-1", name: "ignored" }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "no_projects");
    const ctx = actor.getSnapshot().context;
    expect(ctx.org_id).toBe("dev-org-001");
    expect(ctx.user.first_name).toBe("Maya");
    expect(ctx.underlying_cause_tag).toBe("no_projects");
  });

  it("settles in project_selected when resolveInitialScope returns a project", async () => {
    const project: ProjectSummary = { id: "proj-q4", name: "Q4 Analytics" };
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ project }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-q4");
    expect(ctx.project.name).toBe("Q4 Analytics");
  });

  it("transitions creating_project → project_selected on successful create", async () => {
    const created: ProjectSummary = { id: "proj-new", name: "Q4 Analytics" };
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ no_projects: true }),
      createProject: createProjectOk(created),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "no_projects");
    actor.send({
      type: "create_project_submitted",
      org_name: "Q4 Analytics",
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-new");
    expect(ctx.project.name).toBe("Q4 Analytics");
  });

  it("transient create-project failure transitions to error_recoverable; composer text preserved", async () => {
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ no_projects: true }),
      createProject: createProjectFails("transient backend 500"),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "no_projects");
    actor.send({
      type: "create_project_submitted",
      org_name: "Q4 Analytics",
    });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    const ctx = actor.getSnapshot().context;
    expect(ctx.underlying_cause_tag).toBe("transient");
    // Composer state preserved across the retry boundary.
    expect(ctx.pending_project_name).toBe("Q4 Analytics");
  });

  it("empty project name keeps machine in no_projects with validation error", async () => {
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ no_projects: true }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "no_projects");
    actor.send({
      type: "create_project_submitted",
      org_name: "   ",
    });
    // After processing the event, the machine stays in
    // no_projects — no transition to creating_project.
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("no_projects");
    expect(snap.context.project_validation_error?.kind).toBe("empty");
  });
});

// ─────────────────── Sub-step 01-03: US-204 deep-link behaviors ──────────────

describe("ProjectContextMachine — US-204 deep-link behaviors", () => {
  it("B6: cross-tenant resolveInitialScope output lands in scope_mismatch_terminal with cause cross_tenant", async () => {
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ cross_tenant: true }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
    });
    const actor = createActor(machine, {
      input: { ...MAYA_INPUT, deeplink_project_id: "foreign-project-id" },
    });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "scope_mismatch_terminal");
    const ctx = actor.getSnapshot().context;
    expect(ctx.underlying_cause_tag).toBe("cross_tenant");
  });

  it("B7: project_not_found resolveInitialScope output lands in scope_mismatch_terminal with cause project_not_found", async () => {
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ project_not_found: true }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
    });
    const actor = createActor(machine, {
      input: { ...MAYA_INPUT, deeplink_project_id: "missing-project-id" },
    });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "scope_mismatch_terminal");
    const ctx = actor.getSnapshot().context;
    expect(ctx.underlying_cause_tag).toBe("project_not_found");
  });

  it("B8: open_deep_link event populates context.deeplink_* from payload", async () => {
    // Start with no_projects; arriving open_deep_link should set deeplink_*
    // fields and re-resolve the initial scope. (The event payload keys
    // still use the legacy `intent_*` prefix — that's a deferred follow-up.)
    //
    // Implementation note: the resolveInitialScope invoke fires on initial
    // spawn AND on every re-entry. With `auth_ready { target: self, reenter: true }`,
    // this means the invoke fires twice during bootstrap (once on spawn, once
    // on auth_ready re-entry). We return no_projects for both bootstrap calls;
    // the THIRD call (triggered by open_deep_link) returns the project.
    const project: ProjectSummary = { id: "deep-link-proj", name: "Q4 Analytics" };
    let invokeCallCount = 0;
    const resolveActor: ResolveInitialScopeActor = fromPromise(async () => {
      invokeCallCount += 1;
      if (invokeCallCount <= 2) {
        return { no_projects: true };
      }
      return { project };
    });
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveActor,
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "no_projects");

    // Fire open_deep_link with all four event-payload keys. (The event-
    // payload key names retain the legacy `intent_*` prefix — that rename
    // is a deferred follow-up to MR-D.)
    actor.send({
      type: "open_deep_link",
      intent_project_id: "deep-link-proj",
      intent_session_id: "sess-1",
      intent_resource_id: "ds-1",
      intent_resource_type: "dataset",
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.deeplink_project_id).toBe("deep-link-proj");
    expect(ctx.deeplink_session_id).toBe("sess-1");
    // `intent_resource_id` / `intent_resource_type` are no longer
    // materialized into ctx (audit §7 Tier-1 #2 / MR-D): the orchestrator
    // forwards them directly from the open_deep_link event payload into
    // the project_ready broadcast, without ever touching this ctx.
  });

  it("B9: back_to_projects_clicked clears all deeplink_* fields and exits scope_mismatch_terminal", async () => {
    // Arrive in scope_mismatch_terminal via cross_tenant.
    // The resolveInitialScope invoke fires twice during bootstrap (once on
    // spawn with the input.deeplink_project_id present, once on auth_ready
    // re-entry). Both bootstrap calls return cross_tenant; the third call
    // (triggered by back_to_projects_clicked → resolving_initial_scope) sees
    // the deeplink wish cleared and returns no_projects.
    let invokeCallCount = 0;
    const resolveActor: ResolveInitialScopeActor = fromPromise(async () => {
      invokeCallCount += 1;
      if (invokeCallCount <= 2) {
        return { cross_tenant: true };
      }
      return { no_projects: true };
    });
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveActor,
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
    });
    const actor = createActor(machine, {
      input: { ...MAYA_INPUT, deeplink_project_id: "foreign-id" },
    });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "scope_mismatch_terminal");

    // Confirm deeplink_project_id was carried in.
    expect(actor.getSnapshot().context.deeplink_project_id).toBe("foreign-id");

    // Click back to projects.
    actor.send({ type: "back_to_projects_clicked" });
    await waitFor(actor, (s) => s.value === "no_projects");

    const ctx = actor.getSnapshot().context;
    expect(ctx.deeplink_project_id).toBeNull();
    expect(ctx.deeplink_session_id).toBeNull();
  });
});

describe("ProjectContextMachine — US-207 switching_project (MR-4)", () => {
  it("switching_project_intent moves project_selected → switching_project", async () => {
    const initial: ProjectSummary = { id: "proj-A", name: "Project A" };
    const target: ProjectSummary = { id: "proj-B", name: "Project B" };
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ project: initial }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
      switchProject: switchTo({ project: target }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
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
    const initial: ProjectSummary = { id: "proj-A", name: "Project A" };
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ project: initial }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
      switchProject: switchTo({ access_revoked: true }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    actor.send({
      type: "switching_project_intent",
      new_project_id: "p-revoked",
    });
    await waitFor(actor, (s) => s.value === "scope_mismatch_terminal");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("access_revoked");
  });

  it("switchProject project_not_found → scope_mismatch_terminal", async () => {
    const initial: ProjectSummary = { id: "proj-A", name: "Project A" };
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ project: initial }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
      switchProject: switchTo({ project_not_found: true }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    actor.send({
      type: "switching_project_intent",
      new_project_id: "p-gone",
    });
    await waitFor(actor, (s) => s.value === "scope_mismatch_terminal");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("project_not_found");
  });

  it("switchProject transient failure → error_recoverable", async () => {
    const initial: ProjectSummary = { id: "proj-A", name: "Project A" };
    const machine = createProjectContextMachine({
      resolveInitialScope: resolveTo({ project: initial }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
      switchProject: switchFails("transient backend 500"),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "auth_ready",
      org_id: "dev-org-001",
      user: { first_name: "Maya" },
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    actor.send({
      type: "switching_project_intent",
      new_project_id: "p-flaky",
    });
    await waitFor(actor, (s) => s.value === "error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("transient");
  });
});
