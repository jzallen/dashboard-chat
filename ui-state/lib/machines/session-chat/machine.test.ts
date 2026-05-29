// Unit tests for the SessionChat (J-002 session half) XState machine.
//
// MR-1.5 stub contract: spawns into `waiting_for_project`; `project_ready`
// populates context.
//
// MR-2 contract:
//   S4 — project_ready transitions to `loading_session_list`.
//   S5 — loadSessionList onDone (no pending resume) → session_list_loaded.
//   S6 — loadSessionList onDone (with pending_resume_session_id) → resuming_session.
//   S7 — loadSessionList onError → error_recoverable with cause list_sessions_degraded.
//   S8 — session_clicked from session_list_loaded → resuming_session.
//   S9 — resumeSession onDone (atomic) → session_active with transcript + resource together.
//   S10 — resumeSession onDone (session_not_found) → silent return to session_list_loaded.
//   S11 — resumeSession onDone (dataset_unavailable) → session_active with resource null + cause tag.
//   S12 — refresh_session_list from session_list_loaded → loading_session_list.
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
  SwitchDatasetContextActor,
  SwitchDatasetContextInput,
  SwitchDatasetContextOutput,
  TranscriptMessage,
} from "./machine.ts";
import { createSessionChatMachine } from "./machine.ts";

const MAYA_INPUT = {
  request_id: "R-7a4f-901c",
  principal_id: "dev-user-001",
};

function stubLoadSessionList(
  output: Omit<LoadSessionListOutput, "resume_target">,
): LoadSessionListActor {
  // ADR-030 LEAF-C: the production actor echoes
  // `input.pending_resume_session_id` through `output.resume_target` so
  // the onDone guard can branch on event.output rather than ctx. The
  // stub mirrors that contract — tests that supply a resume target via
  // project_ready exercise the resume path through this channel, just
  // like production.
  return fromPromise<LoadSessionListOutput, LoadSessionListInput>(
    async ({ input }) => ({
      ...output,
      resume_target: input.pending_resume_session_id ?? null,
    }),
  );
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
    expect(ctx.project.id).toBeNull();
    expect(ctx.project.name).toBeNull();
    expect(ctx.session_list).toEqual([]);
    expect(ctx.session_id).toBeNull();
    expect(ctx.pending_resume_session_id).toBeNull();
    // intent_resource_id / intent_resource_type previously asserted here.
    // Removed in the L3 SRP refactor — see
    // docs/refactoring/session-chat-context-srp/refactoring-log.md.
    // Those fields were captured in context but never read by the machine;
    // the dataset-switching events (MR-5) carry resource id/type directly
    // in their event payload, so context capture was pure scope leak.
    // MR-D split the prior `intent_session_id` into
    // `pending_resume_session_id` (this ctx, click- or deeplink-captured)
    // and the URL-level `deeplink_session_id` on project-context.
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
      request_id: "R-broadcast-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    const ctx = actor.getSnapshot().context;
    expect(ctx.org_id).toBe("dev-org-001");
    expect(ctx.project.id).toBe("proj-q4");
    expect(ctx.project.name).toBe("Q4 Analytics");
    expect(ctx.request_id).toBe("R-broadcast-1");
  });

  it("S3: project_ready forwards deeplink_session_id per DESIGN §3.4", async () => {
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
      request_id: "R-broadcast-1",
      // The URL-level deep-link wish flows in via the renamed key
      // (audit §5 / MR-D). intent_resource_id / intent_resource_type
      // remain on the event surface (forward-compat) but are no
      // longer materialized into ctx — the orchestrator routes them
      // through the projection directly.
      deeplink_session_id: "sess-1",
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

  it("S4: project_ready → loading_session_list → session_list_loaded (no resume target)", async () => {
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
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_list).toEqual(SESSIONS_DESC);
    expect(ctx.session_list_next_cursor).toBeNull();
    expect(ctx.session_list_has_more).toBe(false);
  });

  it("S5: empty session list lands in session_list_loaded with no_sessions sub-shape", async () => {
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
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    expect(actor.getSnapshot().context.session_list).toEqual([]);
  });

  it("S6: loadSessionList onDone with pending_resume_session_id → resuming_session", async () => {
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
      request_id: "R-1",
      deeplink_session_id: "sess-t4",
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBe("sess-t4");
    expect(ctx.transcript).toHaveLength(1);
  });

  it("S6b (ADR-030 LEAF-C): loadSessionList input echoes pending_resume_session_id through output.resume_target", async () => {
    // Direct actor-level assertion: per ADR-028 Direction F / ADR-030 §254,
    // branch-relevant data flows out via event.output, not via a context
    // field set before the invoke. The actor receives
    // pending_resume_session_id on its input and echoes it as
    // output.resume_target.
    // Closure-captured probes (array-wrapped to sidestep TS narrowing
    // of `let foo: T | null = null` through async closures).
    const observedInputs: LoadSessionListInput[] = [];
    const observedOutputs: LoadSessionListOutput[] = [];
    const recordingActor = fromPromise<LoadSessionListOutput, LoadSessionListInput>(
      async ({ input }) => {
        observedInputs.push(input);
        const output: LoadSessionListOutput = {
          items: SESSIONS_DESC,
          next_cursor: null,
          has_more: false,
          resume_target: input.pending_resume_session_id ?? null,
        };
        observedOutputs.push(output);
        return output;
      },
    );
    const machine = createSessionChatMachine({
      loadSessionList: recordingActor,
      resumeSession: stubResumeSession({
        session_id: "sess-t4",
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
      request_id: "R-deeplink",
      deeplink_session_id: "sess-t4",
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    expect(observedInputs).toHaveLength(1);
    expect(observedInputs[0].pending_resume_session_id).toBe("sess-t4");
    expect(observedOutputs).toHaveLength(1);
    expect(observedOutputs[0].resume_target).toBe("sess-t4");
  });

  it("S6c (ADR-030 LEAF-C): null resume_target lands in session_list_loaded even if ctx.pending_resume_session_id is non-null", async () => {
    // Negative-channel test: prove the guard reads event.output, NOT ctx.
    // The stub returns resume_target: null regardless of input. The send
    // populates ctx.pending_resume_session_id via project_ready, but
    // because the actor's OUTPUT says no resume, the machine must settle
    // in session_list_loaded. If the guard were still reading ctx, this
    // test would settle in session_active instead.
    const truncatingActor = fromPromise<LoadSessionListOutput, LoadSessionListInput>(
      async () => ({
        items: SESSIONS_DESC,
        next_cursor: null,
        has_more: false,
        resume_target: null,
      }),
    );
    const machine = createSessionChatMachine({
      loadSessionList: truncatingActor,
      resumeSession: stubResumeSession({
        session_id: "sess-t4",
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
      request_id: "R-deeplink",
      deeplink_session_id: "sess-t4",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    expect(actor.getSnapshot().value).toBe("session_list_loaded");
    // ctx.pending_resume_session_id WAS captured by project_ready (LEAF-C
    // does not remove that path — its removal is a follow-up MR). The
    // point of this test is that the OUTPUT channel's null overrides what's
    // in ctx.
    expect(actor.getSnapshot().context.pending_resume_session_id).toBe("sess-t4");
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
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    const ctx = actor.getSnapshot().context;
    expect(ctx.underlying_cause_tag).toBe("list_sessions_degraded");
    expect(ctx.last_live_state).toBe("loading_session_list");
  });

  it("S8: session_clicked from session_list_loaded → resuming_session", async () => {
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
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
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
      request_id: "R-1",
      deeplink_session_id: "sess-t4",
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    expect(violations).toEqual([]);
    expect(actor.getSnapshot().context.resource).toEqual({
      type: "dataset",
      id: "ds-sales-2026",
    });
  });

  it("S10: resumeSession session_not_found → silent return to session_list_loaded", async () => {
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
      request_id: "R-1",
      deeplink_session_id: "sess-deleted",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBeNull();
    expect(ctx.transcript).toEqual([]);
    expect(ctx.pending_resume_session_id).toBeNull();
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
      request_id: "R-1",
      deeplink_session_id: "sess-t4",
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    const ctx = actor.getSnapshot().context;
    expect(ctx.resource).toEqual({ type: null, id: null });
    expect(ctx.underlying_cause_tag).toBe("dataset_not_found");
  });

  it("S12: refresh_session_list from session_list_loaded → loading_session_list", async () => {
    let callCount = 0;
    const loadActor = fromPromise<LoadSessionListOutput, LoadSessionListInput>(
      async ({ input }) => {
        callCount += 1;
        return {
          items: callCount === 1 ? [SESSIONS_DESC[0]] : SESSIONS_DESC,
          next_cursor: null,
          has_more: false,
          resume_target: input.pending_resume_session_id ?? null,
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
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    expect(actor.getSnapshot().context.session_list).toHaveLength(1);
    actor.send({ type: "refresh_session_list" });
    await waitFor(
      () =>
        actor.getSnapshot().value === "session_list_loaded" &&
        actor.getSnapshot().context.session_list.length === 3,
    );
    expect(callCount).toBe(2);
  });

  it("S13: retry_clicked returns to last_live_state from error_recoverable", async () => {
    let callCount = 0;
    const loadActor = fromPromise<LoadSessionListOutput, LoadSessionListInput>(
      async ({ input }) => {
        callCount += 1;
        if (callCount === 1) throw new Error("transient");
        return {
          items: SESSIONS_DESC,
          next_cursor: null,
          has_more: false,
          resume_target: input.pending_resume_session_id ?? null,
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
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    actor.send({ type: "retry_clicked" });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    expect(actor.getSnapshot().context.retries_count).toBe(1);
    expect(actor.getSnapshot().context.underlying_cause_tag).toBeNull();
  });
});

describe("SessionChatMachine — MR-3 new-session lifecycle (US-206)", () => {
  const SEED_SESSIONS: SessionSummary[] = [
    {
      id: "sess-prior",
      title: "Prior",
      last_active_at: "2026-05-12T15:00:00Z",
      active_dataset_id: null,
    },
  ];

  function machineWith(
    overrides: Parameters<typeof createSessionChatMachine>[0],
  ) {
    return createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: SEED_SESSIONS,
        next_cursor: null,
        has_more: false,
      }),
      resumeSession: stubResumeSession({
        session_id: "sess-prior",
        transcript: [],
        active_dataset_id: null,
      }),
      ...overrides,
    });
  }

  async function settleIntoSessionListVisible() {
    const machine = machineWith({});
    const actor = createActor(machine, { input: MAYA_INPUT });
    actor.start();
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    return actor;
  }

  it("S14: new_session_clicked from session_list_loaded → session_welcome with session_id=null", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(
      () => actor.getSnapshot().value === "session_welcome",
    );
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBeNull();
    expect(ctx.transcript).toEqual([]);
    expect(ctx.resource).toEqual({ type: null, id: null });
    expect(ctx.pending_first_message).toBe("");
  });

  it("S15: new_session_clicked while already in session_welcome is a self-no-op", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(
      () => actor.getSnapshot().value === "session_welcome",
    );
    actor.send({ type: "new_session_clicked" });
    expect(actor.getSnapshot().value).toBe("session_welcome");
  });

  it("S16: session_clicked from session_welcome → resuming_session (cancels new-session intent)", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(
      () => actor.getSnapshot().value === "session_welcome",
    );
    actor.send({ type: "session_clicked", session_id: "sess-prior" });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBe("sess-prior");
  });

  it("S17: first_message_sent → session_active via createSessionEagerly", async () => {
    let createCalled = false;
    let receivedContent = "";
    const createActor = fromPromise<
      { session_id: string },
      { project_id: string; principal_id: string; first_message: string }
    >(async ({ input }) => {
      createCalled = true;
      receivedContent = input.first_message;
      return { session_id: "sess-new-001" };
    });
    const machine = machineWith({ createSessionEagerly: createActor });
    const actor = createActor_(machine);
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    actor.send({ type: "new_session_clicked" });
    await waitFor(
      () => actor.getSnapshot().value === "session_welcome",
    );
    actor.send({ type: "first_message_sent", content: "Show me top customers" });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    expect(createCalled).toBe(true);
    expect(receivedContent).toBe("Show me top customers");
    const ctx = actor.getSnapshot().context;
    expect(ctx.session_id).toBe("sess-new-001");
    expect(ctx.pending_first_message).toBe("");
  });

  it("S18: createSessionEagerly onError → error_recoverable with pending_first_message preserved", async () => {
    const failingCreate = fromPromise<
      { session_id: string },
      { project_id: string; principal_id: string; first_message: string }
    >(async () => {
      throw new Error("transient");
    });
    const machine = machineWith({ createSessionEagerly: failingCreate });
    const actor = createActor_(machine);
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    actor.send({ type: "new_session_clicked" });
    await waitFor(
      () => actor.getSnapshot().value === "session_welcome",
    );
    actor.send({ type: "first_message_sent", content: "Show me top customers" });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    const ctx = actor.getSnapshot().context;
    expect(ctx.pending_first_message).toBe("Show me top customers");
    expect(ctx.underlying_cause_tag).toBe("transient");
    expect(ctx.last_live_state).toBe("session_welcome");
  });

  it("S19: retry_clicked from error_recoverable with last_live_state=session_welcome preserves composer", async () => {
    let calls = 0;
    const createActor = fromPromise<
      { session_id: string },
      { project_id: string; principal_id: string; first_message: string }
    >(async () => {
      calls += 1;
      if (calls === 1) throw new Error("transient");
      return { session_id: "sess-new-002" };
    });
    const machine = machineWith({ createSessionEagerly: createActor });
    const actor = createActor_(machine);
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      request_id: "R-1",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    actor.send({ type: "new_session_clicked" });
    await waitFor(
      () => actor.getSnapshot().value === "session_welcome",
    );
    actor.send({ type: "first_message_sent", content: "Show me top customers" });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    expect(actor.getSnapshot().context.pending_first_message).toBe(
      "Show me top customers",
    );
    actor.send({ type: "retry_clicked" });
    await waitFor(
      () => actor.getSnapshot().value === "session_welcome",
    );
    expect(actor.getSnapshot().context.pending_first_message).toBe(
      "Show me top customers",
    );
    // Re-fire the first_message — succeeds.
    actor.send({ type: "first_message_sent", content: "Show me top customers" });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    expect(actor.getSnapshot().context.session_id).toBe("sess-new-002");
  });

  it("S20: project_ready (different project_id) from session_welcome → loading_session_list", async () => {
    const actor = await settleIntoSessionListVisible();
    actor.send({ type: "new_session_clicked" });
    await waitFor(
      () => actor.getSnapshot().value === "session_welcome",
    );
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q3",
      project_name: "Q3 Sales",
      request_id: "R-2",
    });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    const ctx = actor.getSnapshot().context;
    expect(ctx.project.id).toBe("proj-q3");
    expect(ctx.session_id).toBeNull();
  });
});

describe("SessionChatMachine — MR-5 dataset context switching (US-209)", () => {
  const SEED_SESSIONS: SessionSummary[] = [
    {
      id: "sess-q4",
      title: "Q4 chat",
      last_active_at: "2026-05-15T10:00:00Z",
      active_dataset_id: null,
    },
  ];

  /** Build a session-chat machine settled into `session_active` for
   *  session `sess-q4`, with `priorDatasetId` already attached, and a
   *  configurable `switchDatasetContext` actor. `captured` records the
   *  invoke input for the assertions. */
  function buildSessionActive(
    switchOutput:
      | ((input: SwitchDatasetContextInput) => Promise<unknown> | unknown)
      | SwitchDatasetContextOutput,
    priorDatasetId: string | null = null,
  ): {
    actor: ReturnType<typeof createActor_>;
    captured: { input: SwitchDatasetContextInput | null };
  } {
    const captured: { input: SwitchDatasetContextInput | null } = {
      input: null,
    };
    const switchActor: SwitchDatasetContextActor = fromPromise<
      SwitchDatasetContextOutput,
      SwitchDatasetContextInput
    >(async ({ input }) => {
      captured.input = input;
      const out =
        typeof switchOutput === "function"
          ? await (
              switchOutput as (
                i: SwitchDatasetContextInput,
              ) => Promise<unknown> | unknown
            )(input)
          : switchOutput;
      return out as SwitchDatasetContextOutput;
    });
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: SEED_SESSIONS,
        next_cursor: null,
        has_more: false,
      }),
      resumeSession: stubResumeSession({
        session_id: "sess-q4",
        transcript: [],
        active_dataset_id: priorDatasetId,
      }),
      switchDatasetContext: switchActor,
    });
    const actor = createActor_(machine);
    actor.send({
      type: "project_ready",
      org_id: "dev-org-001",
      project_id: "proj-q4",
      project_name: "Q4 Analytics",
      request_id: "R-ds",
    });
    return { actor, captured };
  }

  async function reachSessionActive(
    actor: ReturnType<typeof createActor_>,
  ): Promise<void> {
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");
    actor.send({ type: "session_clicked", session_id: "sess-q4" });
    await waitFor(() => actor.getSnapshot().value === "session_active");
  }

  it("M-DS1: dataset_resolved_by_agent → switching_dataset_context → session_active with resource retargeted + persisted", async () => {
    const { actor, captured } = buildSessionActive({
      resource_type: "dataset",
      resource_id: "ds-patients-2025",
      persisted: true,
    });
    await reachSessionActive(actor);

    actor.send({
      type: "dataset_resolved_by_agent",
      resource_id: "ds-patients-2025",
      resource_type: "dataset",
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    const ctx = actor.getSnapshot().context;
    expect(ctx.resource).toEqual({ type: "dataset", id: "ds-patients-2025" });
    expect(ctx.underlying_cause_tag).toBeNull();
    // Pick is cleared after settle so a stale pick can't bleed forward.
    expect(ctx.intended_resource_id).toBeNull();
    // The invoke input carried the captured pick + session/project context.
    expect(captured.input?.session_id).toBe("sess-q4");
    expect(captured.input?.project_id).toBe("proj-q4");
    expect(captured.input?.intended_resource_id).toBe("ds-patients-2025");
    expect(captured.input?.prior_resource).toEqual({ type: null, id: null });
  });

  it("M-DS2: dataset_picked_directly → switching_dataset_context → session_active retargets resource", async () => {
    const { actor } = buildSessionActive(
      { resource_type: "dataset", resource_id: "ds-customers-2025", persisted: true },
      "ds-sales-2026",
    );
    await reachSessionActive(actor);
    expect(actor.getSnapshot().context.resource).toEqual({
      type: "dataset",
      id: "ds-sales-2026",
    });

    actor.send({
      type: "dataset_picked_directly",
      resource_id: "ds-customers-2025",
      resource_type: "dataset",
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

  it("M-DS3: dataset_access_denied output → session_active, prior resource UNCHANGED, cause surfaced", async () => {
    const { actor, captured } = buildSessionActive(
      (input) => ({
        dataset_access_denied: true as const,
        prior_resource: input.prior_resource,
      }),
      "ds-sales-2026",
    );
    await reachSessionActive(actor);

    actor.send({
      type: "dataset_picked_directly",
      resource_id: "ds-restricted",
      resource_type: "dataset",
    });
    await waitFor(
      () =>
        actor.getSnapshot().value === "session_active" &&
        actor.getSnapshot().context.underlying_cause_tag ===
          "dataset_access_denied",
    );
    const ctx = actor.getSnapshot().context;
    // Prior dataset stays attached (US-209 Example 3 — scope preserved).
    expect(ctx.resource).toEqual({ type: "dataset", id: "ds-sales-2026" });
    expect(ctx.underlying_cause_tag).toBe("dataset_access_denied");
    expect(captured.input?.prior_resource).toEqual({
      type: "dataset",
      id: "ds-sales-2026",
    });
  });

  it("M-DS4: switchDatasetContext onError → error_recoverable; retry_clicked re-enters switching_dataset_context", async () => {
    let calls = 0;
    const { actor } = buildSessionActive(() => {
      calls += 1;
      if (calls === 1) throw new Error("transient: dataset probe 503");
      return {
        resource_type: "dataset",
        resource_id: "ds-after-retry",
        persisted: true,
      };
    });
    await reachSessionActive(actor);

    actor.send({
      type: "dataset_resolved_by_agent",
      resource_id: "ds-after-retry",
      resource_type: "dataset",
    });
    await waitFor(() => actor.getSnapshot().value === "error_recoverable");
    expect(actor.getSnapshot().context.underlying_cause_tag).toBe("transient");
    expect(actor.getSnapshot().context.last_live_state).toBe(
      "switching_dataset_context",
    );

    actor.send({ type: "retry_clicked" });
    await waitFor(
      () =>
        actor.getSnapshot().value === "session_active" &&
        actor.getSnapshot().context.resource.id === "ds-after-retry",
    );
    expect(actor.getSnapshot().context.resource).toEqual({
      type: "dataset",
      id: "ds-after-retry",
    });
  });

  it("M-DS5a: XState single-event-at-a-time — a pick arriving during an in-flight switch is dropped (only one switching_dataset_context runs)", async () => {
    // The safety half of US-209 Example 5: "XState's state-machine
    // semantics ensure only one switching_dataset_context transition can
    // run at a time". With both picks delivered to the raw actor before
    // the first switch settles, the SECOND is dropped — `session_active`
    // is the only state with the dataset-pick handlers; once the machine
    // is in `switching_dataset_context` the second event has no handler.
    let invocations = 0;
    const { actor } = buildSessionActive(async (input) => {
      invocations += 1;
      await new Promise((r) => setTimeout(r, 10));
      return {
        resource_type: "dataset" as const,
        resource_id: input.intended_resource_id,
        persisted: true as const,
      };
    });
    await reachSessionActive(actor);

    actor.send({
      type: "dataset_resolved_by_agent",
      resource_id: "ds-first",
      resource_type: "dataset",
    });
    actor.send({
      type: "dataset_resolved_by_agent",
      resource_id: "ds-second",
      resource_type: "dataset",
    });
    await waitFor(() => actor.getSnapshot().value === "session_active");
    // Exactly one switch ran; the in-flight-collision pick was dropped.
    expect(invocations).toBe(1);
    expect(actor.getSnapshot().context.resource).toEqual({
      type: "dataset",
      id: "ds-first",
    });
  });

  it("M-DS5b: serialized picks (each settling before the next) — most-recent wins", async () => {
    // The other half of US-209 Example 5 / the boundary scenario: when
    // picks are applied serially (the discipline the orchestrator
    // enforces by awaiting `waitForSettledState` per send — D-MR4-06),
    // the most-recent pick's resource_id is the final resource. This is
    // the property the HTTP acceptance scenario observes.
    const { actor } = buildSessionActive((input) => ({
      resource_type: "dataset" as const,
      resource_id: input.intended_resource_id,
      persisted: true as const,
    }));
    await reachSessionActive(actor);

    actor.send({
      type: "dataset_resolved_by_agent",
      resource_id: "ds-first",
      resource_type: "dataset",
    });
    await waitFor(
      () =>
        actor.getSnapshot().value === "session_active" &&
        actor.getSnapshot().context.resource.id === "ds-first",
    );
    actor.send({
      type: "dataset_resolved_by_agent",
      resource_id: "ds-second",
      resource_type: "dataset",
    });
    await waitFor(
      () =>
        actor.getSnapshot().value === "session_active" &&
        actor.getSnapshot().context.resource.id === "ds-second",
    );
    expect(actor.getSnapshot().context.resource).toEqual({
      type: "dataset",
      id: "ds-second",
    });
  });
});

// ───────────────────────── MR-6 — US-210 cross-machine FREEZE/THAW ──────────
//
// The orchestrator broadcasts FREEZE/THAW; the machine declares a top-level
// on.FREEZE reachable from every non-terminal state, a `freeze` side-state
// that records `last_live_state`, an on.THAW that returns there (guarded on
// context.last_live_state — DWD-2 rejected XState history nodes because the
// prior-state value must stay queryable for the harness), and an
// on.replay_abandoned → error_recoverable arm (cause `replay_abandoned`)
// for the 5s replay-buffer timeout. Plus the DWD-7 session_clicked
// stale-intent guard (drop + count when the target is not in the post-THAW
// session_list).

describe("SessionChatMachine — DWD-7 stale-intent guard", () => {
  it("DWD-7: session_clicked for a session absent from session_list is stale-dropped (count++, no resuming_session)", async () => {
    const machine = createSessionChatMachine({
      loadSessionList: stubLoadSessionList({
        items: [{ id: "in-list", title: "Q3", last_active_at: "t", active_dataset_id: null }],
        next_cursor: null,
        has_more: false,
      }),
      resumeSession: stubResumeSession({
        session_id: "in-list",
        transcript: [],
        active_dataset_id: null,
      }),
    });
    const actor = createActor_(machine);
    actor.send({ type: "project_ready", org_id: "o", project_id: "p", project_name: "Q3", request_id: "R-1" });
    await waitFor(() => actor.getSnapshot().value === "session_list_loaded");

    // chat-xyz is NOT in the post-THAW list — stale (the user switched
    // projects during freeze; this is a replayed muscle-memory click).
    actor.send({ type: "session_clicked", session_id: "chat-xyz" });
    // No transition to resuming_session; the drop is silent + counted.
    await new Promise((r) => setTimeout(r, 30));
    expect(actor.getSnapshot().value).toBe("session_list_loaded");
    expect(actor.getSnapshot().context.stale_intents_dropped_count).toBe(1);
    expect(actor.getSnapshot().context.last_stale_intent).toEqual({
      intent_type: "session_clicked",
      target_id: "chat-xyz",
    });
  });
});

// Wraps createActor + start so the per-test boilerplate stays terse.
function createActor_(machine: ReturnType<typeof createSessionChatMachine>) {
  const actor = createActor(machine, { input: MAYA_INPUT });
  actor.start();
  return actor;
}
