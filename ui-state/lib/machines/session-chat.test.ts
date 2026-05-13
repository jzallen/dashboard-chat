// Unit tests for the SessionChat (J-002 session half) XState machine.
//
// MR-1.5 scope (DWD-13 §"MR-to-machine implementation guidance"): the
// session-chat stub has ONLY `waiting_for_project` as a live state. MR-2
// extends with `loading_session_list`, `session_list_visible`,
// `resuming_session`, `session_active`.
//
// These tests pin the MR-1.5 contract MR-2's crafter inherits:
//   S1 — spawns into `waiting_for_project` with empty context.
//   S2 — `project_ready` event populates org_id / project_id / project_name.
//   S3 — `project_ready` forwards intent_* deep-link fields per DESIGN §3.4.
//
// All tests are port-to-port at the XState actor's `send` / snapshot surface.

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import { createSessionChatMachine } from "./session-chat.ts";

const MAYA_INPUT = {
  correlation_id: "R-7a4f-901c",
  principal_id: "dev-user-001",
};

describe("SessionChatMachine — MR-1.5 stub", () => {
  it("S1: spawns into waiting_for_project with empty context", () => {
    const machine = createSessionChatMachine({});
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("waiting_for_project");
    const ctx = snap.context;
    expect(ctx.org_id).toBe("");
    expect(ctx.project_id).toBeNull();
    expect(ctx.project_name).toBeNull();
    expect(ctx.session_list).toEqual([]);
    expect(ctx.session_id).toBeNull();
    expect(ctx.intent_session_id).toBeNull();
    expect(ctx.intent_resource_id).toBeNull();
    expect(ctx.intent_resource_type).toBeNull();
  });

  it("S2: project_ready event populates org_id, project_id, project_name", () => {
    const machine = createSessionChatMachine({});
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-broadcast-1",
    });
    const ctx = actor.getSnapshot().context;
    expect(ctx.org_id).toBe("dev-org-001");
    expect(ctx.project_id).toBe("proj-q4");
    expect(ctx.project_name).toBe("Q4 Analytics");
    expect(ctx.correlation_id).toBe("R-broadcast-1");
    // MR-1.5 stub stays in waiting_for_project; MR-2 will lift the transition.
    expect(actor.getSnapshot().value).toBe("waiting_for_project");
  });

  it("S3: project_ready forwards intent_* deep-link fields per DESIGN §3.4", () => {
    const machine = createSessionChatMachine({});
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-broadcast-1",
      intent_session_id: "sess-1",
      intent_resource_id: "ds-1",
      intent_resource_type: "dataset",
    });
    const ctx = actor.getSnapshot().context;
    expect(ctx.intent_session_id).toBe("sess-1");
    expect(ctx.intent_resource_id).toBe("ds-1");
    expect(ctx.intent_resource_type).toBe("dataset");
  });
});
