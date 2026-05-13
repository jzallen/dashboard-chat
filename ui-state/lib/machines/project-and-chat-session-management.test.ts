// Unit tests for the ProjectAndChatSessionManagement (J-002) XState machine.
//
// Behavior budget for sub-step 01-01 (substrate + walking skeleton):
//   B1 — resolveInitialScope → no_projects_empty_state when backend returns empty.
//   B2 — resolveInitialScope → project_selected when backend returns ≥1 project.
//   B3 — creating_project → project_selected on success.
//   B4 — creating_project → error_recoverable on transient failure;
//         pending_project_name preserved for composer state.
//   B5 — empty project name (whitespace-only) keeps machine in
//         no_projects_empty_state with inline validation error.
//
// Test count budget: 5 distinct behaviors × 2 = 10 unit tests max.
// All tests are port-to-port at the machine's driving port (XState actor's
// public `send` / snapshot surface). No internal-class assertions.

import { describe, expect, it } from "vitest";
import { createActor, fromPromise } from "xstate";

import {
  createProjectAndChatSessionMachine,
  type CreateProjectActor,
  type ProjectSummary,
  type ResolveInitialScopeActor,
  type ResolveInitialScopeOutput,
} from "./project-and-chat-session-management.ts";

const MAYA_INPUT = {
  correlation_id: "R-7a4f-901c",
  principal_id: "dev-user-001",
  org_id: "dev-org-001",
  user_first_name: "Maya",
};

function resolveTo(output: ResolveInitialScopeOutput): ResolveInitialScopeActor {
  return fromPromise(async () => output);
}

function createProjectOk(summary: ProjectSummary): CreateProjectActor {
  return fromPromise(async () => summary);
}

function createProjectFails(message: string): CreateProjectActor {
  return fromPromise<ProjectSummary, { org_name: string; correlation_id: string; principal_id: string }>(
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

describe("ProjectAndChatSessionMachine (J-002) — substrate behaviors", () => {
  it("settles in no_projects_empty_state when resolveInitialScope returns empty", async () => {
    const machine = createProjectAndChatSessionMachine({
      resolveInitialScope: resolveTo({ no_projects: true }),
      createProject: createProjectOk({ id: "p-1", name: "ignored" }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "j001_ready",
      org_id: "dev-org-001",
      user_first_name: "Maya",
    });
    await waitFor(actor, (s) => s.value === "no_projects_empty_state");
    const ctx = actor.getSnapshot().context;
    expect(ctx.org_id).toBe("dev-org-001");
    expect(ctx.user_first_name).toBe("Maya");
    expect(ctx.underlying_cause_tag).toBe("no_projects");
  });

  it("settles in project_selected when resolveInitialScope returns a project", async () => {
    const project: ProjectSummary = { id: "proj-q4", name: "Q4 Analytics" };
    const machine = createProjectAndChatSessionMachine({
      resolveInitialScope: resolveTo({ project }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "j001_ready",
      org_id: "dev-org-001",
      user_first_name: "Maya",
    });
    await waitFor(actor, (s) => s.value === "project_selected");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-q4");
    expect(ctx.project.name).toBe("Q4 Analytics");
  });

  it("transitions creating_project → project_selected on successful create", async () => {
    const created: ProjectSummary = { id: "proj-new", name: "Q4 Analytics" };
    const machine = createProjectAndChatSessionMachine({
      resolveInitialScope: resolveTo({ no_projects: true }),
      createProject: createProjectOk(created),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "j001_ready",
      org_id: "dev-org-001",
      user_first_name: "Maya",
    });
    await waitFor(actor, (s) => s.value === "no_projects_empty_state");
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
    const machine = createProjectAndChatSessionMachine({
      resolveInitialScope: resolveTo({ no_projects: true }),
      createProject: createProjectFails("transient backend 500"),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "j001_ready",
      org_id: "dev-org-001",
      user_first_name: "Maya",
    });
    await waitFor(actor, (s) => s.value === "no_projects_empty_state");
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

  it("empty project name keeps machine in no_projects_empty_state with validation error", async () => {
    const machine = createProjectAndChatSessionMachine({
      resolveInitialScope: resolveTo({ no_projects: true }),
      createProject: createProjectOk({ id: "ignored", name: "ignored" }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "j001_ready",
      org_id: "dev-org-001",
      user_first_name: "Maya",
    });
    await waitFor(actor, (s) => s.value === "no_projects_empty_state");
    actor.send({
      type: "create_project_submitted",
      org_name: "   ",
    });
    // After processing the event, the machine stays in
    // no_projects_empty_state — no transition to creating_project.
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("no_projects_empty_state");
    expect(snap.context.project_validation_error?.kind).toBe("empty");
  });
});
