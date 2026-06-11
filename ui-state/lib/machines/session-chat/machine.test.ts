// Unit tests for the SessionChat (J-002 session half) XState machine.
//
// REPORT-DRIVEN model (ADR-049/050 §e.5, DR-8/AR-8): the machine has ZERO
// egress. It no longer invokes server-side actors; instead it transitions on
// CLIENT-REPORTED past-tense OUTCOMES (the client probes the backend SSOT and
// narrates what it observed). The surviving UI intents (session_clicked,
// new_session_clicked, first_message_sent, refresh_session_list, dataset
// picks) move the machine into a no-invoke WAITING state that SETTLES until
// the matching outcome report arrives.
//
// State surface (no invoke states):
//   waiting_for_project (initial) ─→ awaiting_session_list_report (project_ready)
//   awaiting_session_list_report  ─┬─→ session_list_loaded   (session_list_loaded report)
//                                   └─→ error_recoverable     (session_list_failed report)
//   session_list_loaded           ─┬─→ session_active         (session_resumed report ← session_clicked)
//                                   ├─→ error_recoverable      (session_resume_failed report)
//                                   ├─→ session_welcome        (new_session_clicked)
//                                   └─→ awaiting_session_list_report (refresh_session_list)
//   session_welcome               ─┬─→ session_active         (session_created report ← first_message_sent)
//                                   └─→ error_recoverable      (session_create_failed report)
//   session_active                ─┬─→ session_active         (dataset_context_switched report ← dataset pick)
//                                   └─→ error_recoverable      (dataset_context_switch_failed report)
//   error_recoverable             ─→ last_live_state          (refresh_session_list / report retry)
//
// All tests are port-to-port at the XState actor's `send` / snapshot surface.

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import type { SessionSummary, TranscriptMessage } from "./index.ts";
import { createSessionChatMachine } from "./index.ts";

const MAYA_INPUT = {
  request_id: "R-7a4f-901c",
  principal_id: "dev-user-001",
};

function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() >= deadline) {
        return reject(new Error("waitFor: timeout"));
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

// Wraps createActor + start so the per-test boilerplate stays terse.
function createActor_(machine: ReturnType<typeof createSessionChatMachine>) {
  const actor = createActor(machine, { input: MAYA_INPUT });
  actor.start();
  return actor;
}

function sendProjectReady(
  actor: ReturnType<typeof createActor_>,
  overrides: Record<string, unknown> = {},
): void {
  actor.send({
    type: "project_ready",
    org_id: "dev-org-001",
    project_id: "proj-q4",
    project_name: "Q4 Analytics",
    request_id: "R-1",
    ...overrides,
  });
}

const SESSIONS_DESC: SessionSummary[] = [
  {
    id: "sess-t4",
    title: "Latest",
    last_active_at: "2026-05-12T16:00:00Z",
    active_dataset_id: null,
  },
  {
    id: "sess-t3",
    title: "Third",
    last_active_at: "2026-05-12T15:00:00Z",
    active_dataset_id: null,
  },
  {
    id: "sess-t1",
    title: "Oldest",
    last_active_at: "2026-05-12T13:00:00Z",
    active_dataset_id: null,
  },
];

describe("SessionChatMachine — spawn + project_ready", () => {
  it("S1: spawns into waiting_for_project with empty context", () => {
    const machine = createSessionChatMachine({});
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("waiting_for_project");
    const ctx = snap.context;
    expect(ctx.org_id).toBe("");
    expect(ctx.project.id).toBeNull();
    expect(ctx.project.name).toBeNull();
    expect(ctx.session_list).toEqual([]);
    expect(ctx.session_id).toBeNull();
    expect(ctx.pending_resume_session_id).toBeNull();
  });

  it("S2: project_ready → awaiting_session_list_report (no invoke; waits for the client report)", () => {
    const machine = createSessionChatMachine({});
    const actor = createActor_(machine);
    sendProjectReady(actor, { request_id: "R-broadcast-1" });
    // No actor invoked — the machine settles WAITING in
    // awaiting_session_list_report (a no-invoke state). It does NOT advance
    // to session_list_loaded until the client reports session_list_loaded.
    const snap = actor.getSnapshot();
    expect(snap.value).toBe("awaiting_session_list_report");
    const ctx = snap.context;
    expect(ctx.org_id).toBe("dev-org-001");
    expect(ctx.project.id).toBe("proj-q4");
    expect(ctx.project.name).toBe("Q4 Analytics");
    expect(ctx.request_id).toBe("R-broadcast-1");
  });
});

describe("SessionChatMachine — session list report", () => {
  it("S4: session_list_loaded report → session_list_loaded with sessions landed", async () => {
    const machine = createSessionChatMachine({});
    const actor = createActor_(machine);
    sendProjectReady(actor);
    expect(actor.getSnapshot().value).toBe("awaiting_session_list_report");

    actor.send({
      type: "session_list_loaded",
      sessions: SESSIONS_DESC,
      next_cursor: null,
      has_more: false,
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_list).toEqual(SESSIONS_DESC);
    expect(ctx.session_list_next_cursor).toBeNull();
    expect(ctx.session_list_has_more).toBe(false);
  });

  it("S5: empty session_list_loaded report lands in session_list_loaded (no_sessions sub-shape)", async () => {
    const machine = createSessionChatMachine({});
    const actor = createActor_(machine);
    sendProjectReady(actor);
    actor.send({
      type: "session_list_loaded",
      sessions: [],
      next_cursor: null,
      has_more: false,
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    expect(actor.getSnapshot().context.session_list).toEqual([]);
  });

  it("S7: session_list_failed report → error_recoverable with cause list_sessions_degraded", async () => {
    const machine = createSessionChatMachine({});
    const actor = createActor_(machine);
    sendProjectReady(actor);
    actor.send({ type: "session_list_failed", cause: "list_sessions_degraded" });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    const ctx = actor.getSnapshot().context;
    expect(ctx.underlying_cause_tag).toBe("list_sessions_degraded");
    expect(ctx.last_live_state).toBe("awaiting_session_list_report");
  });
});

describe("SessionChatMachine — resume report", () => {
  async function reachSessionListLoaded(): Promise<
    ReturnType<typeof createActor_>
  > {
    const machine = createSessionChatMachine({});
    const actor = createActor_(machine);
    sendProjectReady(actor);
    actor.send({
      type: "session_list_loaded",
      sessions: SESSIONS_DESC,
      next_cursor: null,
      has_more: false,
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    return actor;
  }

  it("S8: session_clicked → settle; session_resumed report → session_active", async () => {
    const actor = await reachSessionListLoaded();
    actor.send({ type: "session_clicked", session_id: "sess-t3" });
    // session_clicked moves the machine into a WAITING state (not a transient
    // invoke). It SETTLES there until the client reports session_resumed.
    actor.send({
      type: "session_resumed",
      session_id: "sess-t3",
      transcript: [],
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    expect(actor.getSnapshot().context.session_id).toBe("sess-t3");
  });

  it("S9 (IC-J002-3): session_resumed report is atomic — transcript + resource set together", async () => {
    const actor = await reachSessionListLoaded();
    const transcript: TranscriptMessage[] = [
      { id: "m1", role: "user", content: "what's in the sales table?", ts: "2026-05-12T10:00:00Z" },
      { id: "m2", role: "assistant", content: "let me look", ts: "2026-05-12T10:00:01Z" },
    ];

    const violations: string[] = [];
    actor.subscribe((snap) => {
      if (snap.value === "session_active") {
        const c = snap.context;
        const hasTranscript = c.transcript.length > 0;
        const hasResource = c.resource.id !== null && c.resource.type !== null;
        if (hasTranscript !== hasResource) {
          violations.push(
            `partial materialization: transcript=${hasTranscript} resource=${hasResource}`,
          );
        }
      }
    });

    actor.send({ type: "session_clicked", session_id: "sess-t4" });
    actor.send({
      type: "session_resumed",
      session_id: "sess-t4",
      transcript,
      resource: { type: "dataset", id: "ds-sales-2026" },
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    expect(violations).toEqual([]);
    expect(actor.getSnapshot().context.session_id).toBe("sess-t4");
    expect(actor.getSnapshot().context.resource).toEqual({
      type: "dataset",
      id: "ds-sales-2026",
    });
  });

  it("S11: session_resumed report with session_dataset_unavailable → session_active, resource null + dataset_not_found cause", async () => {
    const actor = await reachSessionListLoaded();
    actor.send({ type: "session_clicked", session_id: "sess-t4" });
    actor.send({
      type: "session_resumed",
      session_id: "sess-t4",
      transcript: [],
      session_dataset_unavailable: true,
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    const ctx = actor.getSnapshot().context;
    expect(ctx.resource).toEqual({ type: null, id: null });
    expect(ctx.underlying_cause_tag).toBe("dataset_not_found");
  });

  it("S8e: session_resume_failed report → error_recoverable with transient cause", async () => {
    const actor = await reachSessionListLoaded();
    actor.send({ type: "session_clicked", session_id: "sess-t3" });
    actor.send({ type: "session_resume_failed", cause: "session_resume_failed" });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    const ctx = actor.getSnapshot().context;
    expect(ctx.underlying_cause_tag).toBe("session_resume_failed");
    expect(ctx.last_live_state).toBe("session_list_loaded");
  });

  it("S12: refresh_session_list from session_list_loaded → awaiting_session_list_report", async () => {
    const actor = await reachSessionListLoaded();
    actor.send({ type: "refresh_session_list" });
    expect(actor.getSnapshot().value).toBe("awaiting_session_list_report");
  });

  it("DWD-7: session_clicked for a session absent from session_list is stale-dropped (count++, stays put)", async () => {
    const actor = await reachSessionListLoaded();
    actor.send({ type: "session_clicked", session_id: "chat-xyz" });
    await new Promise((r) => setTimeout(r, 20));
    expect(actor.getSnapshot().value).toBe("session_list_loaded");
    expect(actor.getSnapshot().context.stale_intents_dropped_count).toBe(1);
    expect(actor.getSnapshot().context.last_stale_intent).toEqual({
      intent_type: "session_clicked",
      target_id: "chat-xyz",
    });
  });
});

describe("SessionChatMachine — error_recoverable self-heal convergence (D2)", () => {
  async function reachErrorRecoverable(): Promise<
    ReturnType<typeof createActor_>
  > {
    const machine = createSessionChatMachine({});
    const actor = createActor_(machine);
    sendProjectReady(actor);
    actor.send({ type: "session_list_failed", cause: "list_sessions_degraded" });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    return actor;
  }

  it("SH1: error_recoverable + fresh session_list_loaded report → converges to session_list_loaded with the reported sessions", async () => {
    const actor = await reachErrorRecoverable();
    actor.send({
      type: "session_list_loaded",
      sessions: SESSIONS_DESC,
      next_cursor: null,
      has_more: false,
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_list).toEqual(SESSIONS_DESC);
    expect(ctx.session_list_next_cursor).toBeNull();
    expect(ctx.session_list_has_more).toBe(false);
  });

  it("SH2: error_recoverable + refresh_session_list → re-enters awaiting_session_list_report", async () => {
    const actor = await reachErrorRecoverable();
    actor.send({ type: "refresh_session_list" });
    expect(actor.getSnapshot().value).toBe("awaiting_session_list_report");
  });
});

describe("SessionChatMachine — new-session lifecycle (US-206)", () => {
  const SEED_SESSIONS: SessionSummary[] = [
    {
      id: "sess-prior",
      title: "Prior",
      last_active_at: "2026-05-12T15:00:00Z",
      active_dataset_id: null,
    },
  ];

  async function settleIntoSessionListVisible(): Promise<
    ReturnType<typeof createActor_>
  > {
    const machine = createSessionChatMachine({});
    const actor = createActor_(machine);
    sendProjectReady(actor);
    actor.send({
      type: "session_list_loaded",
      sessions: SEED_SESSIONS,
      next_cursor: null,
      has_more: false,
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    return actor;
  }

  it("S14: new_session_clicked from session_list_loaded → session_welcome with session_id=null", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(() => actor.getSnapshot().value === "session_welcome");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBeNull();
    expect(ctx.transcript).toEqual([]);
    expect(ctx.resource).toEqual({ type: null, id: null });
    expect(ctx.pending_first_message).toBe("");
  });

  it("S15: new_session_clicked while already in session_welcome is a self-no-op", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(() => actor.getSnapshot().value === "session_welcome");
    actor.send({ type: "new_session_clicked" });
    expect(actor.getSnapshot().value).toBe("session_welcome");
  });

  it("S16: session_clicked from session_welcome → settle → session_resumed report → session_active", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(() => actor.getSnapshot().value === "session_welcome");
    actor.send({ type: "session_clicked", session_id: "sess-prior" });
    actor.send({ type: "session_resumed", session_id: "sess-prior", transcript: [] });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    expect(actor.getSnapshot().context.session_id).toBe("sess-prior");
  });

  it("S17: first_message_sent → settle → session_created report → session_active", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(() => actor.getSnapshot().value === "session_welcome");
    actor.send({ type: "first_message_sent", content: "Show me top customers" });
    // first_message_sent captures the composer text and settles WAITING; the
    // client reports session_created.
    expect(actor.getSnapshot().context.pending_first_message).toBe(
      "Show me top customers",
    );
    actor.send({
      type: "session_created",
      session: { session_id: "sess-new-001" },
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBe("sess-new-001");
    expect(ctx.pending_first_message).toBe("");
  });

  it("S18: session_create_failed report → error_recoverable, pending_first_message preserved", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(() => actor.getSnapshot().value === "session_welcome");
    actor.send({ type: "first_message_sent", content: "Show me top customers" });
    actor.send({ type: "session_create_failed", cause: "session_create_failed" });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    const ctx = actor.getSnapshot().context;
    expect(ctx.pending_first_message).toBe("Show me top customers");
    expect(ctx.underlying_cause_tag).toBe("session_create_failed");
    expect(ctx.last_live_state).toBe("session_welcome");
  });

  it("S20: project_ready (different project_id) from session_welcome → awaiting_session_list_report", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(() => actor.getSnapshot().value === "session_welcome");
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q3",
      project_name: "Q3 Sales",
      request_id: "R-2",
    });
    expect(actor.getSnapshot().value).toBe("awaiting_session_list_report");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-q3");
    expect(ctx.session_id).toBeNull();
  });
});

describe("SessionChatMachine — dataset context switching (US-209)", () => {
  const SEED_SESSIONS: SessionSummary[] = [
    {
      id: "sess-q4",
      title: "Q4 chat",
      last_active_at: "2026-05-15T10:00:00Z",
      active_dataset_id: null,
    },
  ];

  async function reachSessionActive(
    priorResource: { type: "dataset" | null; id: string | null } = {
      type: null,
      id: null,
    },
  ): Promise<ReturnType<typeof createActor_>> {
    const machine = createSessionChatMachine({});
    const actor = createActor_(machine);
    sendProjectReady(actor);
    actor.send({
      type: "session_list_loaded",
      sessions: SEED_SESSIONS,
      next_cursor: null,
      has_more: false,
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    actor.send({ type: "session_clicked", session_id: "sess-q4" });
    actor.send({
      type: "session_resumed",
      session_id: "sess-q4",
      transcript: [],
      resource: priorResource,
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    return actor;
  }

  it("M-DS1: dataset_resolved_by_agent → settle → dataset_context_switched report → resource retargeted", async () => {
    const actor = await reachSessionActive();
    actor.send({
      type: "dataset_resolved_by_agent",
      resource_id: "ds-patients-2025",
      resource_type: "dataset",
    });
    actor.send({
      type: "dataset_context_switched",
      resource: { type: "dataset", id: "ds-patients-2025" },
    });
    await waitFor(
      () =>
        actor.getSnapshot().value === "session_active" &&
        actor.getSnapshot().context.resource.id === "ds-patients-2025",
    );
    const ctx = actor.getSnapshot().context;
    expect(ctx.resource).toEqual({ type: "dataset", id: "ds-patients-2025" });
    expect(ctx.underlying_cause_tag).toBeNull();
  });

  it("M-DS2: dataset_picked_directly → settle → dataset_context_switched report → resource retargeted", async () => {
    const actor = await reachSessionActive({ type: "dataset", id: "ds-sales-2026" });
    expect(actor.getSnapshot().context.resource).toEqual({
      type: "dataset",
      id: "ds-sales-2026",
    });
    actor.send({
      type: "dataset_picked_directly",
      resource_id: "ds-customers-2025",
      resource_type: "dataset",
    });
    actor.send({
      type: "dataset_context_switched",
      resource: { type: "dataset", id: "ds-customers-2025" },
    });
    await waitFor(
      () =>
        actor.getSnapshot().value === "session_active" &&
        actor.getSnapshot().context.resource.id === "ds-customers-2025",
    );
    expect(actor.getSnapshot().context.resource).toEqual({
      type: "dataset",
      id: "ds-customers-2025",
    });
  });

  it("M-DS4: dataset_context_switch_failed report → error_recoverable with cause", async () => {
    const actor = await reachSessionActive({ type: "dataset", id: "ds-sales-2026" });
    actor.send({
      type: "dataset_resolved_by_agent",
      resource_id: "ds-restricted",
      resource_type: "dataset",
    });
    actor.send({
      type: "dataset_context_switch_failed",
      cause: "dataset_access_denied",
    });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    const ctx = actor.getSnapshot().context;
    expect(ctx.underlying_cause_tag).toBe("dataset_access_denied");
    expect(ctx.last_live_state).toBe("session_active");
  });
});
