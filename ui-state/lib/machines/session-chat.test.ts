// Unit tests for the SessionChat (J-002 session half) XState machine.
//
// MR-1.5 stub contract: spawns into `waiting_for_project`; `project_ready`
// populates context.
//
// MR-2 contract:
//   S4 — project_ready transitions to `loading_session_list`.
//   S5 — loadSessionList onDone (no intent) → session_list_visible.
//   S6 — loadSessionList onDone (with intent_session_id) → resuming_session.
//   S7 — loadSessionList onError → error_recoverable with cause list_sessions_degraded.
//   S8 — session_clicked from session_list_visible → resuming_session.
//   S9 — resumeSession onDone (atomic) → session_active with transcript + resource together.
//   S10 — resumeSession onDone (session_not_found) → silent return to session_list_visible.
//   S11 — resumeSession onDone (dataset_unavailable) → session_active with resource null + cause tag.
//   S12 — refresh_session_list from session_list_visible → loading_session_list.
//   S13 — retry_clicked from error_recoverable returns to last_live_state.
//
// All tests are port-to-port at the XState actor's `send` / snapshot surface.

import { describe, expect, it } from "vitest";
import { createActor, fromPromise } from "xstate";

import type {
  LoadSessionListActor,
  LoadSessionListInput,
  LoadSessionListOutput,
  ResumeSessionActor,
  ResumeSessionInput,
  ResumeSessionOutput,
  SessionSummary,
  TranscriptMessage,
} from "./session-chat.ts";
import { createSessionChatMachine } from "./session-chat.ts";

const MAYA_INPUT = {
  correlation_id: "R-7a4f-901c",
  principal_id: "dev-user-001",
};

function stubLoadSessionList(output: LoadSessionListOutput): LoadSessionListActor {
  return fromPromise<LoadSessionListOutput, LoadSessionListInput>(async () => output);
}

function stubLoadSessionListFailing(error: string): LoadSessionListActor {
  return fromPromise<LoadSessionListOutput, LoadSessionListInput>(async () => {
    throw new Error(error);
  });
}

function stubResumeSession(output: ResumeSessionOutput): ResumeSessionActor {
  return fromPromise<ResumeSessionOutput, ResumeSessionInput>(async () => output);
}

function stubResumeSessionFailing(error: string): ResumeSessionActor {
  return fromPromise<ResumeSessionOutput, ResumeSessionInput>(async () => {
    throw new Error(error);
  });
}

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

  it("S2: project_ready event populates org_id, project_id, project_name", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: [],
        next_cursor: null,
        has_more: false,
      }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-broadcast-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_visible");
    const ctx = actor.getSnapshot().context;
    expect(ctx.org_id).toBe("dev-org-001");
    expect(ctx.project_id).toBe("proj-q4");
    expect(ctx.project_name).toBe("Q4 Analytics");
    expect(ctx.correlation_id).toBe("R-broadcast-1");
  });

  it("S3: project_ready forwards intent_* deep-link fields per DESIGN §3.4", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: [],
        next_cursor: null,
        has_more: false,
      }),
      resumeSession: stubResumeSession({
        session_id: "sess-1",
        transcript: [],
        active_dataset_id: "ds-1",
      }),
    });
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
    await waitFor(() => actor.getSnapshot().value === "session_active");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBe("sess-1");
    expect(ctx.resource).toEqual({ type: "dataset", id: "ds-1" });
  });
});

describe("SessionChatMachine — MR-2 session list + resume", () => {
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

  it("S4: project_ready → loading_session_list → session_list_visible (no intent)", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: SESSIONS_DESC,
        next_cursor: null,
        has_more: false,
      }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_visible");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_list).toEqual(SESSIONS_DESC);
    expect(ctx.session_list_next_cursor).toBeNull();
    expect(ctx.session_list_has_more).toBe(false);
  });

  it("S5: empty session list lands in session_list_visible with no_sessions sub-shape", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: [],
        next_cursor: null,
        has_more: false,
      }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_visible");
    expect(actor.getSnapshot().context.session_list).toEqual([]);
  });

  it("S6: loadSessionList onDone with intent_session_id → resuming_session", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: SESSIONS_DESC,
        next_cursor: null,
        has_more: false,
      }),
      resumeSession: stubResumeSession({
        session_id: "sess-t4",
        transcript: [
          { id: "m1", role: "user", content: "hi", ts: "2026-05-12T16:00:00Z" },
        ],
        active_dataset_id: null,
      }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
      intent_session_id: "sess-t4",
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBe("sess-t4");
    expect(ctx.transcript).toHaveLength(1);
  });

  it("S7: loadSessionList onError → error_recoverable with cause list_sessions_degraded", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionListFailing("boom"),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    const ctx = actor.getSnapshot().context;
    expect(ctx.underlying_cause_tag).toBe("list_sessions_degraded");
    expect(ctx.last_live_state).toBe("loading_session_list");
  });

  it("S8: session_clicked from session_list_visible → resuming_session", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: SESSIONS_DESC,
        next_cursor: null,
        has_more: false,
      }),
      resumeSession: stubResumeSession({
        session_id: "sess-t3",
        transcript: [],
        active_dataset_id: null,
      }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_visible");
    actor.send({ type: "session_clicked", session_id: "sess-t3" });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    expect(actor.getSnapshot().context.session_id).toBe("sess-t3");
  });

  it("S9 (IC-J002-3): resumeSession onDone is atomic — transcript + resource set together", async () => {
    const transcript: TranscriptMessage[] = [
      { id: "m1", role: "user", content: "what's in the sales table?", ts: "2026-05-12T10:00:00Z" },
      { id: "m2", role: "assistant", content: "let me look", ts: "2026-05-12T10:00:01Z" },
    ];
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: SESSIONS_DESC,
        next_cursor: null,
        has_more: false,
      }),
      resumeSession: stubResumeSession({
        session_id: "sess-t4",
        transcript,
        active_dataset_id: "ds-sales-2026",
      }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();

    // Track every snapshot — if a snapshot lands in session_active with
    // transcript but no resource (or vice versa), the invariant is broken.
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

    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
      intent_session_id: "sess-t4",
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    expect(violations).toEqual([]);
    expect(actor.getSnapshot().context.resource).toEqual({
      type: "dataset",
      id: "ds-sales-2026",
    });
  });

  it("S10: resumeSession session_not_found → silent return to session_list_visible", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: SESSIONS_DESC,
        next_cursor: null,
        has_more: false,
      }),
      resumeSession: stubResumeSession({ session_not_found: true }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
      intent_session_id: "sess-deleted",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_visible");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBeNull();
    expect(ctx.transcript).toEqual([]);
    expect(ctx.intent_session_id).toBeNull();
    // Silent → no underlying_cause_tag surfaced.
    expect(ctx.underlying_cause_tag).toBeNull();
  });

  it("S11: resumeSession dataset_unavailable → session_active with resource null + dataset_not_found cause", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: SESSIONS_DESC,
        next_cursor: null,
        has_more: false,
      }),
      resumeSession: stubResumeSession({
        session_id: "sess-t4",
        transcript: [],
        active_dataset_id: null,
        dataset_unavailable: true,
      }),
    });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
      intent_session_id: "sess-t4",
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    const ctx = actor.getSnapshot().context;
    expect(ctx.resource).toEqual({ type: null, id: null });
    expect(ctx.underlying_cause_tag).toBe("dataset_not_found");
  });

  it("S12: refresh_session_list from session_list_visible → loading_session_list", async () => {
    let callCount = 0;
    const loadActor = fromPromise<LoadSessionListOutput, LoadSessionListInput>(
      async () => {
        callCount += 1;
        return {
          items: callCount === 1 ? [SESSIONS_DESC[0]] : SESSIONS_DESC,
          next_cursor: null,
          has_more: false,
        };
      },
    );
    const machine = createSessionChatMachine({ loadSessionList: loadActor });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_visible");
    expect(actor.getSnapshot().context.session_list).toHaveLength(1);
    actor.send({ type: "refresh_session_list" });
    await waitFor(
      () =>
        actor.getSnapshot().value === "session_list_visible" &&
        actor.getSnapshot().context.session_list.length === 3,
    );
    expect(callCount).toBe(2);
  });

  it("S13: retry_clicked returns to last_live_state from error_recoverable", async () => {
    let callCount = 0;
    const loadActor = fromPromise<LoadSessionListOutput, LoadSessionListInput>(
      async () => {
        callCount += 1;
        if (callCount === 1) throw new Error("transient");
        return { items: SESSIONS_DESC, next_cursor: null, has_more: false };
      },
    );
    const machine = createSessionChatMachine({ loadSessionList: loadActor });
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      correlation_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    actor.send({ type: "retry_clicked" });
    await waitFor(() => actor.getSnapshot().value === "session_list_visible");
    expect(actor.getSnapshot().context.retries).toBe(1);
    expect(actor.getSnapshot().context.underlying_cause_tag).toBeNull();
  });
});
