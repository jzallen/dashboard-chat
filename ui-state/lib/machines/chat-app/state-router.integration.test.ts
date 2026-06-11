// In-process INTEGRATION tests for the ADR-046 `/state` actor surface — the SOLE
// read/write surface of the ui-state tier (the per-machine `/flow/<wire>` mounts
// were retired at MR-7).
//
// These drive the LIVE ui-state HTTP tier via `app.fetch` (no socket, no Redis):
//   - GET  /state          → the whole-actor ChatAppStateDocument (.getSnapshot)
//   - POST /state/events    → apply ONE event, return the new document (.send)
//   - GET  /state/stream    → SSE; the document pushed on every change (.subscribe)
// Mocks are ONLY at the child port boundaries (the onboarding child's `fetch`;
// `fromPromise` fakes for project-context + session-chat resolvers).
//
// Coverage: the /state surface shape + bootstrap (Decision 3a) + stream, PLUS the
// onboarding-behavior, failure-simulation authorization gate, request-id minting,
// and principal-isolation behaviors the retired per-machine wire used to host —
// now exercised over `POST /state/events` (the byte-equivalence of each region to
// the log fold is pinned separately in derive-state-document.contract.test.ts).
//
// References:
//   docs/decisions/adr-046-*.md  — StateProxy actor surface; Decision 3/3a; §9 MR-7
//   docs/decisions/adr-035-*.md  — failure-simulation authorization gate

import { probe } from "@dashboard-chat/shared-failure-simulation";
import { afterEach, describe, expect, it } from "vitest";
import { fromPromise } from "xstate";

import { buildChatAppApp } from "../../../index.ts";
import { createNoopChatAppSnapshotStore } from "../../persistence/chatapp-snapshot-store.ts";
import {
  createNoopFlowEventLog,
  type FlowEventLog,
} from "../../persistence/redis.ts";
import { makeMockFetch, makeTestConfig } from "../../testing/test-config.ts";
import type { RequestClient } from "../onboarding/index.ts";
import type { ChatAppDeps } from "./index.ts";
import type { ChatAppStateDocument } from "./projection/derive-state-document.ts";

const MAYA_PROFILE = { email: "maya@acme", name: "Maya Chen" };
const PROJECT_A = { id: "proj-A", name: "Project A" };

/** Returning user — backend /api/orgs/me reports an org (cascade reaches chat). */
function returningFetch(
  org: { id: string; name: string } = { id: "org-1", name: "Acme Data" },
): RequestClient {
  return makeMockFetch({ profile: MAYA_PROFILE, existingOrg: org });
}

/** New user — re-verify OK, backend 404 (no org), create OK (org id "org-1"). */
function okFetch(): RequestClient {
  return makeMockFetch({ profile: MAYA_PROFILE, orgId: "org-1" });
}

// (rejectingFetch removed — the re-verify/session_rejected path it drove retired under the client-reported model; CDO-S3.)

function fakeChatAppDeps(): ChatAppDeps {
  return {
    projectContext: {
      resolveInitialScope: fromPromise(async () => ({ project: PROJECT_A })),
      createProject: fromPromise(async () => PROJECT_A),
      switchProject: fromPromise(async ({ input }) => ({
        project: {
          id: (input as { new_project_id: string }).new_project_id,
          name: "Switched",
        },
      })),
    },
    sessionChat: {
      loadSessionList: fromPromise(async () => ({
        items: [],
        next_cursor: null,
        has_more: false,
        resume_target: null,
      })),
      resumeSession: fromPromise(async ({ input }) => ({
        session_id: (input as { session_id: string }).session_id,
        transcript: [],
        active_dataset_id: null,
      })),
    },
  } as unknown as ChatAppDeps;
}

interface Scenario {
  app: ReturnType<typeof buildChatAppApp>;
  eventLog: FlowEventLog;
}

function buildScenario(opts: { requestClient: RequestClient }): Scenario {
  const eventLog = createNoopFlowEventLog();
  const app = buildChatAppApp({
    eventLog,
    snapshotStore: createNoopChatAppSnapshotStore(),
    chatAppDeps: fakeChatAppDeps(),
    config: makeTestConfig(),
    requestClient: opts.requestClient,
    logTransition: () => undefined,
  });
  return { app, eventLog };
}

/** A scenario that captures `logTransition` records, for the request-id assertions. */
function buildSpyScenario(): {
  app: ReturnType<typeof buildChatAppApp>;
  records: Record<string, unknown>[];
} {
  const records: Record<string, unknown>[] = [];
  const app = buildChatAppApp({
    eventLog: createNoopFlowEventLog(),
    snapshotStore: createNoopChatAppSnapshotStore(),
    chatAppDeps: fakeChatAppDeps(),
    config: makeTestConfig(),
    requestClient: okFetch(),
    logTransition: (r) => records.push(r),
  });
  return { app, records };
}

function enableFailureSimulation(): void {
  probe({ ENVIRONMENT: "ci", FAILURE_SIMULATION_ENABLED: "true" }, "ui-state");
}
function disableFailureSimulation(): void {
  probe({}, "ui-state");
}

afterEach(() => {
  disableFailureSimulation();
});

// ───────────────────────────── transport helpers ─────────────────────────────

/** GET /state for a principal — returns the parsed state document. */
async function getState(
  app: Scenario["app"],
  userId: string,
): Promise<ChatAppStateDocument> {
  const res = await app.fetch(
    new Request("http://t/state", {
      method: "GET",
      headers: { "X-User-Id": userId },
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as ChatAppStateDocument;
}

/** POST /state/events — apply ONE event, return { status, document }. The
 *  document is undefined-shaped on a non-200 (the body is the error envelope). */
async function postStateEvent(
  app: Scenario["app"],
  body: Record<string, unknown>,
  opts: {
    userId: string;
    bearer?: string;
    email?: string;
    headers?: Record<string, string>;
  },
): Promise<{ status: number; document: ChatAppStateDocument; raw: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-User-Id": opts.userId,
    // Auth-proxy injects X-User-Email alongside X-User-Id; the cold-start seeds
    // it into the onboarding child's context.user.email (INV-PCO single writer).
    // Defaults to maya@acme so identity is populated for the common case; a test
    // can override via opts.email or opts.headers.
    "X-User-Email": opts.email ?? "maya@acme",
    ...(opts.headers ?? {}),
  };
  if (opts.bearer !== undefined) headers.authorization = `Bearer ${opts.bearer}`;
  const res = await app.fetch(
    new Request("http://t/state/events", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  const raw = (await res.json()) as Record<string, unknown>;
  return { status: res.status, document: raw as unknown as ChatAppStateDocument, raw };
}

/** A pull-based SSE frame reader over the streaming Response: each call yields
 *  the next parsed `data:` document; a buffer carries partial frames between
 *  calls so a POST can interleave between frame 1 and frame 2. */
function frameReader(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  return {
    async next(): Promise<ChatAppStateDocument> {
      for (;;) {
        const idx = buffer.indexOf("\n\n");
        if (idx >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = frame
            .split("\n")
            .find((l) => l.startsWith("data:"));
          if (dataLine) {
            return JSON.parse(dataLine.slice("data:".length).trim());
          }
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended before a frame arrived");
        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel: () => reader.cancel().catch(() => undefined),
  };
}

// ═════════════════ 1 — POST /state/events returns the whole-actor document ═════════════════

describe("ADR-046: POST /state/events returns the whole-actor document", () => {
  it("a returning user cascades onboarding→project→chat; the document carries all three regions", async () => {
    const { app } = buildScenario({ requestClient: returningFetch() });

    // begin: the reserved session_begin event cold-starts the actor. Under the
    // client-reported model the onboarding child settles in awaiting_org_report —
    // it does NOT probe the server, so no automatic cascade yet.
    const begin = await postStateEvent(
      app,
      { type: "session_begin" },
      { userId: "u1", bearer: "tok-1" },
    );
    expect(begin.status).toBe(200);
    expect(begin.document.regions.onboarding.state).toBe("awaiting_org_report");

    // The client reports the org it observed → onboarding ready → the parent
    // advances to engaged.project_context. Under the client-reported model the
    // project-context child then WAITS on the scope report (awaiting_scope_report);
    // there is no server-side resolve, so the cascade pauses at project_context.
    const afterOrg = await postStateEvent(
      app,
      { type: "org_found", payload: { org: { id: "org-1", name: "Acme Data" } } },
      { userId: "u1", bearer: "tok-1" },
    );
    expect(afterOrg.status).toBe(200);
    expect(afterOrg.document.phase).toBe("project_context");
    expect(afterOrg.document.regions.onboarding.state).toBe("ready");
    expect(afterOrg.document.regions.projectContext.state).toBe(
      "awaiting_scope_report",
    );

    // The client probes the backend and reports the resolved project →
    // project-context settles project_selected → the parent advances to
    // engaged.chat. The POST response IS the cascaded document.
    const { status, document } = await postStateEvent(
      app,
      { type: "scope_resolved", payload: { project: PROJECT_A } },
      { userId: "u1", bearer: "tok-1" },
    );
    expect(status).toBe(200);

    // The returning user cascaded all the way to chat; each region is present.
    expect(document.phase).toBe("chat");
    expect(document.regions.onboarding.state).toBe("ready");
    expect(document.regions.onboarding.context.org).toEqual({
      id: "org-1",
      name: "Acme Data",
    });
    expect(document.regions.projectContext.state).toBe("project_selected");
    expect(document.regions.projectContext.context.project).toEqual({
      id: "proj-A",
      name: "Project A",
    });
    expect(document.regions.sessionChat.state).toBe("session_list_loaded");

    // active_scope is the deepest-resolved region's scope (org + project).
    expect(document.active_scope).toEqual({
      org_id: "org-1",
      project_id: "proj-A",
      resource_type: null,
      resource_id: null,
    });

    // The POST response IS the new state document — a follow-up GET /state agrees.
    const reread = await getState(app, "u1");
    expect(reread.regions).toEqual(document.regions);
    expect(reread.phase).toBe(document.phase);
  });

  it("a client org report drives onboarding awaiting_org_report → needs_org → ready", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });

    const bootstrap = await postStateEvent(
      app,
      { type: "session_begin" },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(bootstrap.document.regions.onboarding.state).toBe("awaiting_org_report");

    // The client reports no org exists yet → needs_org (org-setup landing).
    const notFound = await postStateEvent(
      app,
      { type: "org_not_found", payload: {} },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(notFound.document.regions.onboarding.state).toBe("needs_org");

    // The client created the org and reports it → ready.
    const { status, document } = await postStateEvent(
      app,
      { type: "org_created", payload: { org: { id: "org-1", name: "Acme Data" } } },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(200);
    expect(document.regions.onboarding.state).toBe("ready");
    expect(document.regions.onboarding.context.org.id).toBe("org-1");
  });

  it("a new user bootstraps to awaiting_org_report with identity seeded from X-User-Email, then reports needs_org", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });
    const { document } = await postStateEvent(
      app,
      { type: "session_begin" },
      { userId: "u2", bearer: "tok-2", email: "maya@acme" },
    );
    // Client-reported model: settles in awaiting_org_report (no server probe).
    // Identity is seeded from the X-User-Email header (INV-PCO single writer);
    // display_name is null (auth-proxy injects no such header).
    expect(document.regions.onboarding.state).toBe("awaiting_org_report");
    expect(document.regions.onboarding.context.org.id).toBeNull();
    expect(document.regions.onboarding.context.user.email).toBe("maya@acme");
    expect(document.regions.onboarding.context.user.display_name).toBeNull();

    // The client reports no org → needs_org, identity preserved.
    const notFound = await postStateEvent(
      app,
      { type: "org_not_found", payload: {} },
      { userId: "u2", bearer: "tok-2", email: "maya@acme" },
    );
    expect(notFound.document.regions.onboarding.state).toBe("needs_org");
    expect(notFound.document.regions.onboarding.context.user.email).toBe("maya@acme");
  });

  // (session_rejected via re-verify retired — client-reported model has no server probe; CDO-S3 owns rejection.)
});

// ═════════════════ 2 — onboarding ACL (phase-dispatched, closed vocabulary) ═════════════════

describe("ADR-046: the onboarding ACL is enforced on POST /state/events while onboarding is active", () => {
  it("refuses an unmodeled onboarding event (400, no-op)", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });

    const { status } = await postStateEvent(
      app,
      { type: "totally_unknown_event", payload: {} },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(400);

    // The flow is unchanged — still awaiting_org_report (no client report applied).
    const doc = await getState(app, "u2");
    expect(doc.regions.onboarding.state).toBe("awaiting_org_report");
  });

  it("refuses an event that names no event type (400)", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });

    const { status, raw } = await postStateEvent(
      app,
      { payload: { org_name: "Acme Data" } } as Record<string, unknown>,
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(400);
    expect(raw.error).toBeTruthy();
  });

  it("refuses an org submission carrying no organization name (400)", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });

    const { status, raw } = await postStateEvent(
      app,
      { type: "org_form_submitted", payload: {} },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(400);
    expect(String(raw.error)).toMatch(/invalid_request/);
  });

  // (org-name validation in onboarding retired — org_form_submitted handler removed; CDO-S3 reintroduces submit + validation.)
});

// ═════════════════ 3 — failure-simulation authorization gate (ADR-035) ═════════════════

describe("ADR-046: the forced-failure side-channel is gated on POST /state/events", () => {
  it("refuses a forced failure when the failure-simulation switch is off (403, no-op)", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });
    // __force_failure__ only transitions from needs_org — report org_not_found first.
    await postStateEvent(app, { type: "org_not_found", payload: {} }, { userId: "u2", bearer: "tok-2" });

    const { status, raw } = await postStateEvent(
      app,
      { type: "__force_failure__", payload: { tag: "transient" } },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(403);
    expect(String(raw.error)).toMatch(/failure-simulation/i);

    const doc = await getState(app, "u2");
    expect(doc.regions.onboarding.state).toBe("needs_org");
  });

  it("routes a forced failure into error_recoverable when the switch is on", async () => {
    enableFailureSimulation();
    const { app } = buildScenario({ requestClient: okFetch() });
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });
    // __force_failure__ only transitions from needs_org — report org_not_found first.
    const bootstrap = await postStateEvent(
      app,
      { type: "org_not_found", payload: {} },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(bootstrap.document.regions.onboarding.state).toBe("needs_org");

    const { status, document } = await postStateEvent(
      app,
      { type: "__force_failure__", payload: { tag: "transient" } },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(200);
    expect(document.regions.onboarding.state).toBe("error_recoverable");
    expect(document.regions.onboarding.context.underlying_cause_tag).toBe("transient");
  });

  it("refuses a forced failure naming an unrecognized cause at the boundary (400)", async () => {
    enableFailureSimulation();
    const { app } = buildScenario({ requestClient: okFetch() });
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });
    // __force_failure__ only transitions from needs_org — report org_not_found first.
    await postStateEvent(app, { type: "org_not_found", payload: {} }, { userId: "u2", bearer: "tok-2" });

    const { status, raw } = await postStateEvent(
      app,
      { type: "__force_failure__", payload: { tag: "not-a-cause" } },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(400);
    expect(String(raw.error)).toMatch(/invalid_request/);

    const doc = await getState(app, "u2");
    expect(doc.regions.onboarding.state).toBe("needs_org");
    expect(doc.regions.onboarding.context.underlying_cause_tag).toBeNull();
  });
});

// ═════════════════ 4 — an event always targets the verified principal's own actor ═════════════════

describe("ADR-046: an event targets the verified principal's own actor", () => {
  it("ignores a stray flow_id in the body and targets the caller's own actor", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });

    const { status, document } = await postStateEvent(
      app,
      {
        flow_id: "session-onboarding:u9",
        type: "org_found",
        payload: { org: { id: "org-1", name: "Acme Data" } },
      },
      { userId: "u2", bearer: "tok-2" },
    );
    expect(status).toBe(200);
    expect(document.regions.onboarding.state).toBe("ready");

    // u9's actor was never touched — reading as u9 yields the anonymous document.
    const u9 = await getState(app, "u9");
    expect(u9.regions.onboarding.state).toBe("awaiting_org_report");
    expect(u9.regions.onboarding.context.org.id).toBeNull();
  });
});

// ═════════════════ 5 — GET /state pre/post bootstrap (Decision 3a) ═════════════════

describe("ADR-046: GET /state folds to the anonymous document pre-bootstrap", () => {
  it("returns the anonymous document and does NOT cold-start", async () => {
    const { app } = buildScenario({ requestClient: returningFetch() });

    const anon = await getState(app, "u1");
    expect(anon.phase).toBe("onboarding");
    expect(anon.regions.onboarding.state).toBe("awaiting_org_report");
    expect(anon.active_scope.org_id).toBe("");

    // A second pre-bootstrap read is STILL anonymous — the first read did not
    // mint an actor (Decision 3a: GET /state never cold-starts).
    const anonAgain = await getState(app, "u1");
    expect(anonAgain.regions.onboarding.state).toBe("awaiting_org_report");
  });

  it("returns the live document once the principal has bootstrapped", async () => {
    const { app } = buildScenario({ requestClient: returningFetch() });

    // Cold-start, then drive to chat via the client's org + scope reports
    // (client-reported model: onboarding advances on org_found, project-context
    // advances on scope_resolved).
    await postStateEvent(app, { type: "session_begin" }, { userId: "u1", bearer: "tok-1" });
    await postStateEvent(
      app,
      { type: "org_found", payload: { org: { id: "org-1", name: "Acme Data" } } },
      { userId: "u1", bearer: "tok-1" },
    );
    await postStateEvent(
      app,
      { type: "scope_resolved", payload: { project: PROJECT_A } },
      { userId: "u1", bearer: "tok-1" },
    );

    const live = await getState(app, "u1");
    expect(live.phase).toBe("chat");
    expect(live.regions.onboarding.state).toBe("ready");
    expect(live.regions.onboarding.context.org).toEqual({
      id: "org-1",
      name: "Acme Data",
    });
  });
});

// ═════════════════ 6 — GET /state/stream first frame + fresh frame on a child-log event ═════════════════

describe("ADR-046: GET /state/stream emits documents", () => {
  it("emits a first document frame, then a fresh document after a child-log event", async () => {
    const { app } = buildScenario({ requestClient: okFetch() });

    // Bootstrap a new user → awaiting_org_report (client-reported model, no probe).
    await postStateEvent(app, { type: "session_begin" }, { userId: "u2", bearer: "tok-2" });

    const streamRes = await app.fetch(
      new Request("http://t/state/stream?budget_ms=2000", {
        method: "GET",
        headers: { "X-User-Id": "u2" },
      }),
    );
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get("content-type")).toContain("text/event-stream");

    const frames = frameReader(streamRes);
    try {
      // First frame: the current document (awaiting_org_report).
      const first = await frames.next();
      expect(first.regions.onboarding.state).toBe("awaiting_org_report");

      // A child-log event (the client's org_not_found report) must push a fresh
      // document frame.
      const applied = await postStateEvent(
        app,
        { type: "org_not_found", payload: {} },
        { userId: "u2", bearer: "tok-2" },
      );
      expect(applied.document.regions.onboarding.state).toBe("needs_org");

      const second = await frames.next();
      expect(second.regions.onboarding.state).toBe("needs_org");
    } finally {
      await frames.cancel();
    }
  });
});

// ═════════════════ 7 — centralized request-id minting (requestId middleware) ═════════════════

describe("ADR-046: request-id minting via requestId() middleware on /state/events", () => {
  it("honors an inbound X-Request-Id across both session_begin and a forwarded event", async () => {
    const { app, records } = buildSpyScenario();
    const inbound = "inbound-req-id-123";

    const beginRes = await app.fetch(
      new Request("http://t/state/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-User-Id": "u2",
          "X-Request-Id": inbound,
          authorization: "Bearer tok-2",
        },
        body: JSON.stringify({ type: "session_begin" }),
      }),
    );
    expect(beginRes.status).toBe(200);
    expect(beginRes.headers.get("x-request-id")).toBe(inbound);

    const eventRes = await app.fetch(
      new Request("http://t/state/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-User-Id": "u2",
          "X-Request-Id": inbound,
        },
        body: JSON.stringify({
          type: "org_form_submitted",
          payload: { org_name: "Acme Data" },
        }),
      }),
    );
    expect(eventRes.status).toBe(200);
    expect(eventRes.headers.get("x-request-id")).toBe(inbound);

    const begin = records.find((r) => r.event === "chat_app.session_begin");
    const eventReceived = records.find((r) => r.event === "chat_app.event_received");
    expect(begin?.request_id).toBe(inbound);
    expect(eventReceived?.request_id).toBe(inbound);
  });

  it("mints a request id when no inbound header is present", async () => {
    const { app, records } = buildSpyScenario();

    const res = await app.fetch(
      new Request("http://t/state/events", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-User-Id": "u2",
          authorization: "Bearer tok-2",
        },
        body: JSON.stringify({ type: "session_begin" }),
      }),
    );
    expect(res.status).toBe(200);

    const minted = res.headers.get("x-request-id");
    expect(minted).toBeTruthy();
    expect(minted).not.toBe("");

    const begin = records.find((r) => r.event === "chat_app.session_begin");
    expect(begin?.request_id).toBe(minted);
  });
});
