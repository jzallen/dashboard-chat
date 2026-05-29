// Acceptance / integration tests for the LIVE ui-state HTTP tier — now driven by
// the ChatApp coordinator actor (ADR-044 Phase 4).
//
// These drive the in-process Hono app via `app.fetch` (no live socket, no compose
// stack). They inject a MOCK `fetch` as the onboarding child's I/O port
// (deps.request_client) so its re-verify + org-create resolvers exercise their
// real code paths against canned `Response`s, and `fromPromise` fakes for the
// project-context + session-chat child resolver actors (mocks ONLY at the child
// port boundaries, ADR-028). They assert on the public projection — the single
// read contract (ADR-027), now DERIVED from the ChatApp snapshot
// (deriveProjection) instead of an event-log fold.
//
// Persistence note (ADR-044 §2): the live ChatApp actor is the state-of-record;
// the append-only FlowEventLog is demoted to SSE/audit + projection bookkeeping.
// So these tests assert the PROJECTION (the contract) rather than event-log
// CONTENT (the retired event-sourcing mechanism).

import { probe } from "@dashboard-chat/shared-failure-simulation";
import { afterEach, describe, expect, it } from "vitest";
import { fromPromise } from "xstate";

import { buildChatAppApp } from "./index.ts";
import type { ChatAppDeps } from "./lib/machines/chat-app/index.ts";
import { createNoopChatAppSnapshotStore } from "./lib/persistence/chatapp-snapshot-store.ts";
import {
  createNoopFlowEventLog,
  type FlowEventLog,
} from "./lib/persistence/redis.ts";
import type { RequestClient } from "./lib/machines/session-onboarding/index.ts";
import { makeMockFetch, makeTestConfig } from "./lib/testing/test-config.ts";

const MAYA_PROFILE = {
  email: "maya@acme",
  name: "Maya Chen",
};

/** Mock fetch for a NEW user — re-verify OK, backend /api/orgs/me 404 (no org),
 *  create/reissue OK (org id "org-1"). */
function okFetch(): RequestClient {
  return makeMockFetch({ profile: MAYA_PROFILE, orgId: "org-1" });
}

/** Mock fetch for a RETURNING user — backend /api/orgs/me reports an org. */
function returningFetch(
  org: { id: string; name: string } = { id: "org-1", name: "Acme Data" },
): RequestClient {
  return makeMockFetch({ profile: MAYA_PROFILE, existingOrg: org });
}

/** Mock fetch that answers 401 for the designated bad bearer at
 *  /oauth/userinfo, driving the session_rejected path. */
function rejectingFetch(badToken: string): RequestClient {
  return makeMockFetch({ profile: MAYA_PROFILE, orgId: "org-1", badToken });
}

const PROJECT_A = { id: "proj-A", name: "Project A" };

/** `fromPromise` fakes at every project-context + session-chat child port. These
 *  let the parent's onboarding→project→chat cascade settle in-process when a
 *  returning user reaches `ready`; the onboarding child uses the mock `fetch`. */
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

interface BeginResult {
  flow_id: string;
  request_id: string;
  state: string;
  context: {
    user: {
      email: string | null;
      display_name: string | null;
      first_name: string | null;
    };
    org: { id: string | null; name: string | null };
    project?: { id: string | null; name: string | null };
    session_list?: unknown[];
    underlying_cause_tag: string | null;
  };
  active_scope?: {
    org_id: string;
    project_id: string | null;
    resource_type: string | null;
    resource_id: string | null;
  };
}

async function begin(
  app: Scenario["app"],
  opts: { userId: string; bearer: string; orgId?: string; path?: string },
): Promise<BeginResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-User-Id": opts.userId,
    authorization: `Bearer ${opts.bearer}`,
  };
  if (opts.orgId !== undefined) headers["X-Org-Id"] = opts.orgId;
  const res = await app.fetch(
    new Request(`http://t${opts.path ?? "/flow/session-onboarding"}/begin`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as BeginResult;
}

async function postEvent(
  app: Scenario["app"],
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.fetch(
    new Request("http://t/flow/session-onboarding/event", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
  let parsed: Record<string, unknown>;
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  return { status: res.status, body: parsed };
}

/** Read a flow's projection through GET /projection. The route derives the
 *  flow_id from the verified `X-User-Id` header + the route's machine. */
async function readProjection(
  app: Scenario["app"],
  userId: string,
  machine = "session-onboarding",
): Promise<BeginResult> {
  const res = await app.fetch(
    new Request(`http://t/flow/${machine}/projection`, {
      method: "GET",
      headers: { "X-User-Id": userId },
    }),
  );
  return (await res.json()) as BeginResult;
}

function enableFailureSimulation(): void {
  probe({ ENVIRONMENT: "ci", FAILURE_SIMULATION_ENABLED: "true" }, "ui-state");
}
function disableFailureSimulation(): void {
  probe({}, "ui-state");
}

let active: Scenario | null = null;
afterEach(() => {
  active = null;
  disableFailureSimulation();
});

// ── Spec 1 — Returning user with an org lands ready ──
describe("Spec 1: returning user with an org lands ready", () => {
  it("projects ready with the user + backend org populated (login slice)", async () => {
    active = buildScenario({ requestClient: returningFetch() });
    const proj = await begin(active.app, {
      userId: "u1",
      bearer: "tok-1",
      orgId: "org-1",
    });

    expect(proj.state).toBe("ready");
    expect(proj.context.user.display_name).toBe("Maya Chen");
    expect(proj.context.user.email).toBe("maya@acme");
    // Org id AND name come from the backend (the SSOT), not the header.
    expect(proj.context.org).toEqual({ id: "org-1", name: "Acme Data" });
  });

  it("retains the ready login projection after the cascade advances past onboarding", async () => {
    // The onboarding child is phase-scoped — stopped on the advance to engaged.
    // The derived login-and-org-setup projection reads the RETAINED outcome, so
    // a later read still reports ready with the resolved org (ADR-044 §2).
    active = buildScenario({ requestClient: returningFetch() });
    await begin(active.app, { userId: "u1", bearer: "tok-1", orgId: "org-1" });

    const proj = await readProjection(active.app, "u1", "login-and-org-setup");
    expect(proj.state).toBe("ready");
    expect(proj.context.org).toEqual({ id: "org-1", name: "Acme Data" });
    expect(proj.context.user.email).toBe("maya@acme");
  });
});

// ── Spec 2 — New user with no org reaches needs_org ──
describe("Spec 2: new user with no org reaches needs_org with identity populated", () => {
  it("projects needs_org with email non-null and org null", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const proj = await begin(active.app, { userId: "u2", bearer: "tok-2" });

    expect(proj.state).toBe("needs_org");
    expect(proj.context.org.id).toBeNull();
    expect(proj.context.user.email).toBe("maya@acme");
    expect(proj.context.user.display_name).toBe("Maya Chen");
  });

  it("ignores the X-Org-Id header for the decision (audit-only): backend 404 → needs_org", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const proj = await begin(active.app, {
      userId: "u2",
      bearer: "tok-2",
      orgId: "org-stale-claim",
    });

    expect(proj.state).toBe("needs_org");
    expect(proj.context.org.id).toBeNull();
  });
});

// ── Spec 3 — Re-verification failure → session_rejected ──
describe("Spec 3: re-verification failure rejects the session", () => {
  it("projects session_rejected over HTTP 200 with no user state", async () => {
    active = buildScenario({ requestClient: rejectingFetch("tok-bad") });
    const proj = await begin(active.app, { userId: "u3", bearer: "tok-bad" });

    expect(proj.state).toBe("session_rejected");
    expect(proj.context.underlying_cause_tag).toBeTruthy();
    expect(proj.context.user.email).toBeNull();
  });
});

// ── Spec 4 — Org submission from needs_org reaches ready ──
describe("Spec 4: org submission from needs_org reaches ready", () => {
  it("creates the org, reaches ready, and the user stays populated", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });
    expect(beginProj.state).toBe("needs_org");

    const { status, body } = await postEvent(
      active.app,
      { type: "org_form_submitted", payload: { org_name: "Acme Data" } },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(200);
    expect(body.state).toBe("ready");
    expect((body.context as BeginResult["context"]).org.id).toBe("org-1");
    expect((body.context as BeginResult["context"]).user.email).toBe("maya@acme");
  });
});

// ── Spec 5 — Invalid org name keeps needs_org (domain rule) ──
describe("Spec 5: invalid org name keeps needs_org", () => {
  it("surfaces a validation error and stays in needs_org", async () => {
    active = buildScenario({ requestClient: okFetch() });
    await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(
      active.app,
      { type: "org_form_submitted", payload: { org_name: "" } },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(200);
    const ctx = body.context as {
      org: { id: string | null };
      org_validation_error: { kind: string } | null;
    };
    expect(body.state).toBe("needs_org");
    expect(ctx.org_validation_error?.kind).toBe("empty");
    expect(ctx.org.id).toBeNull();
  });
});

// ── Spec 7 — Globally-duplicate org name → inline duplicate error ──
describe("Spec 7: a taken org name keeps needs_org with a duplicate error", () => {
  it("maps the backend name-collision (409) to an inline duplicate error", async () => {
    active = buildScenario({
      requestClient: makeMockFetch({ profile: MAYA_PROFILE, orgNameTaken: true }),
    });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });
    expect(beginProj.state).toBe("needs_org");

    const { status, body } = await postEvent(
      active.app,
      { type: "org_form_submitted", payload: { org_name: "Acme Data" } },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(200);
    const ctx = body.context as {
      org: { id: string | null };
      org_validation_error: { kind: string } | null;
    };
    expect(body.state).toBe("needs_org");
    expect(ctx.org_validation_error?.kind).toBe("duplicate");
    expect(ctx.org.id).toBeNull();
  });
});

// ── Legacy-path alias — login-and-org-setup must still resolve (LEAF-2) ──
describe("Legacy alias: the legacy login-and-org-setup wire path resolves", () => {
  it("accepts the legacy machine name on /event without 404", async () => {
    active = buildScenario({ requestClient: okFetch() });
    await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const res = await active.app.fetch(
      new Request("http://t/flow/login-and-org-setup/event", {
        method: "POST",
        headers: { "content-type": "application/json", "X-User-Id": "u2" },
        body: JSON.stringify({
          type: "org_form_submitted",
          payload: { org_name: "Acme Data" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const proj = (await res.json()) as BeginResult;
    expect(proj.state).toBe("ready");
  });

  it("does not 404 on the legacy /flow/login-and-org-setup/begin HTTP path", async () => {
    active = buildScenario({ requestClient: returningFetch() });
    const proj = await begin(active.app, {
      userId: "u1",
      bearer: "tok-1",
      path: "/flow/login-and-org-setup",
    });
    expect(proj.state).toBe("ready");
  });
});

// ── /event ACL — closed vocabulary + well-formedness (onboarding wire) ──
describe("Slice 1: a malformed event missing its event type is refused", () => {
  it("refuses an event that names no event type", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const { status, body } = await postEvent(
      active.app,
      { payload: { org_name: "Acme Data" } },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("accepts a well-formed org submission and reaches ready", async () => {
    active = buildScenario({ requestClient: okFetch() });
    await begin(active.app, { userId: "u2", bearer: "tok-2" });
    const { status, body } = await postEvent(
      active.app,
      { type: "org_form_submitted", payload: { org_name: "Acme Data" } },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(200);
    expect(body.state).toBe("ready");
  });
});

describe("Slice 3: the forced-failure side-channel is gated unless the switch is on", () => {
  it("refuses a forced failure when the failure-simulation switch is off", async () => {
    active = buildScenario({ requestClient: okFetch() });
    await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(
      active.app,
      { type: "__force_failure__", payload: { tag: "transient" } },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(403);
    expect(String(body.error)).toMatch(/failure-simulation/i);
    const proj = await readProjection(active.app, "u2");
    expect(proj.state).toBe("needs_org");
  });

  it("routes a forced failure into the recoverable-error screen when the switch is on", async () => {
    enableFailureSimulation();
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });
    expect(beginProj.state).toBe("needs_org");

    const { status, body } = await postEvent(
      active.app,
      { type: "__force_failure__", payload: { tag: "transient" } },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(200);
    expect(body.state).toBe("error_recoverable");
    expect((body.context as Record<string, unknown>).underlying_cause_tag).toBe(
      "transient",
    );
  });
});

describe("Slice 4: a forced failure naming an unrecognized cause is refused at the boundary", () => {
  it("refuses a forced failure whose cause is not in the failure vocabulary", async () => {
    enableFailureSimulation();
    active = buildScenario({ requestClient: okFetch() });
    await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(
      active.app,
      { type: "__force_failure__", payload: { tag: "not-a-cause" } },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/invalid_request/);
    const proj = await readProjection(active.app, "u2");
    expect(proj.state).toBe("needs_org");
    expect(proj.context.underlying_cause_tag).toBeNull();
  });
});

describe("Slice 5: an event always targets the verified principal's own flow", () => {
  it("ignores a stray flow_id naming another principal and targets the caller's own flow", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });
    expect(beginProj.state).toBe("needs_org");

    const { status, body } = await postEvent(
      active.app,
      {
        flow_id: "session-onboarding:u9",
        type: "org_form_submitted",
        payload: { org_name: "Acme Data" },
      },
      { "X-User-Id": "u2", authorization: "Bearer tok-2" },
    );
    expect(status).toBe(200);
    expect(body.state).toBe("ready");

    // u9's flow was never touched — reading as u9 yields the anonymous default.
    const u9 = await readProjection(active.app, "u9");
    expect(u9.state).not.toBe("ready");
    expect(u9.context.org.id).toBeNull();
  });
});

describe("Slice 6: a malformed org submission is refused while the empty-name domain rule stays in the model", () => {
  it("refuses an org submission that carries no organization name", async () => {
    active = buildScenario({ requestClient: okFetch() });
    await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(
      active.app,
      { type: "org_form_submitted", payload: {} },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/invalid_request/);
    const proj = await readProjection(active.app, "u2");
    expect(proj.state).toBe("needs_org");
  });

  it("still surfaces the empty-name validation error for an empty organization name", async () => {
    active = buildScenario({ requestClient: okFetch() });
    await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(
      active.app,
      { type: "org_form_submitted", payload: { org_name: "" } },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(200);
    expect(body.state).toBe("needs_org");
    expect(
      (body.context as { org_validation_error?: { kind?: string } })
        .org_validation_error?.kind,
    ).toBe("empty");
  });
});

describe("Vocabulary closed: an unknown event type is refused at the ACL (400, no-op)", () => {
  it("refuses an unmodeled event type at the boundary and leaves the flow unchanged", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });
    expect(beginProj.state).toBe("needs_org");

    const { status, body } = await postEvent(
      active.app,
      { type: "totally_unknown_event", payload: {} },
      { "X-User-Id": "u2" },
    );
    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/invalid_request/);
    const proj = await readProjection(active.app, "u2");
    expect(proj.state).toBe("needs_org");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ChatApp wiring (ADR-044 Phase 4) — one actor serves all three machines'
// projections as byte-stable derived views.
// ═══════════════════════════════════════════════════════════════════════════
describe("ChatApp wiring: one coordinator actor serves all three machine projections", () => {
  it("a returning user cascades onboarding→project→chat; each wire path derives its own slice", async () => {
    active = buildScenario({ requestClient: returningFetch() });
    await begin(active.app, { userId: "u1", bearer: "tok-1", orgId: "org-1" });

    // login-and-org-setup slice → ready.
    const login = await readProjection(active.app, "u1", "login-and-org-setup");
    expect(login.state).toBe("ready");
    expect(login.flow_id).toBe("login-and-org-setup:u1");
    expect(login.context.org).toEqual({ id: "org-1", name: "Acme Data" });

    // project-and-chat-session-management slice → project_selected.
    const project = await readProjection(
      active.app,
      "u1",
      "project-and-chat-session-management",
    );
    expect(project.state).toBe("project_selected");
    expect(project.flow_id).toBe("project-and-chat-session-management:u1");
    expect(project.context.project).toEqual({ id: "proj-A", name: "Project A" });
    expect(project.active_scope).toEqual({
      org_id: "org-1",
      project_id: "proj-A",
      resource_type: null,
      resource_id: null,
    });

    // session-chat slice → session list loaded for the selected project.
    const chat = await readProjection(active.app, "u1", "session-chat");
    expect(chat.state).toBe("session_list_loaded");
    expect(chat.flow_id).toBe("session-chat:u1");
    expect(chat.context.project).toEqual({ id: "proj-A", name: "Project A" });
  });

  it("the canonical project-context alias resolves to the same project slice", async () => {
    active = buildScenario({ requestClient: returningFetch() });
    await begin(active.app, { userId: "u1", bearer: "tok-1", orgId: "org-1" });

    const proj = await readProjection(active.app, "u1", "project-context");
    expect(proj.state).toBe("project_selected");
    expect(proj.flow_id).toBe("project-context:u1");
  });

  it("an unknown wire machine path is not served (404)", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const res = await active.app.fetch(
      new Request("http://t/flow/not-a-machine/projection", {
        method: "GET",
        headers: { "X-User-Id": "u1" },
      }),
    );
    expect(res.status).toBe(404);
  });

  it("a cold projection read for an unknown principal folds to the anonymous default", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const proj = await readProjection(active.app, "nobody", "login-and-org-setup");
    expect(proj.flow_id).toBe("login-and-org-setup:nobody");
    expect(proj.context.org.id).toBeNull();
    expect(proj.state).not.toBe("ready");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Centralized request-id minting via requestId() middleware.
// ═══════════════════════════════════════════════════════════════════════════
describe("Centralized request-id minting via requestId() middleware", () => {
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

  it("honors an inbound X-Request-Id across both /begin and /event", async () => {
    const { app, records } = buildSpyScenario();
    const inbound = "inbound-req-id-123";

    const beginRes = await app.fetch(
      new Request("http://t/flow/session-onboarding/begin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-User-Id": "u2",
          "X-Request-Id": inbound,
          authorization: "Bearer tok-2",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(beginRes.status).toBe(200);
    expect(beginRes.headers.get("x-request-id")).toBe(inbound);

    const eventRes = await app.fetch(
      new Request("http://t/flow/session-onboarding/event", {
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

    const orgClaim = records.find(
      (r) => r.event === "session_onboarding.org_claim",
    );
    const eventReceived = records.find(
      (r) => r.event === "session_onboarding.event_received",
    );
    expect(orgClaim?.request_id).toBe(inbound);
    expect(eventReceived?.request_id).toBe(inbound);
  });

  it("mints a request id when no inbound header is present", async () => {
    const { app, records } = buildSpyScenario();

    const res = await app.fetch(
      new Request("http://t/flow/session-onboarding/begin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-User-Id": "u2",
          authorization: "Bearer tok-2",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(200);

    const minted = res.headers.get("x-request-id");
    expect(minted).toBeTruthy();
    expect(minted).not.toBe("");

    const orgClaim = records.find(
      (r) => r.event === "session_onboarding.org_claim",
    );
    expect(orgClaim?.request_id).toBe(minted);
  });
});
