// Acceptance / integration tests for the session-onboarding HTTP tier.
//
// These map directly to the Event-Model Phase-4 Given/When/Then specs
// (docs/feature/session-onboarding/design/event-model.md). They drive the
// in-process Hono app via `app.fetch` (no live socket, no compose stack),
// inject a MOCK `fetch` as the I/O port (deps.request_client) so the re-verify
// + org-create resolvers exercise their real code paths against canned
// `Response`s, and assert on the public projection shape — the single read
// contract.
//
// Port-to-port: every test enters through the `/flow/session-onboarding/*`
// driving port (the ACL router) and asserts at the projection / FlowEventLog
// driven-port boundary. The only test double is the mock `fetch` at the WorkOS
// `/oauth/userinfo` + backend org-create driven-port boundary (a true external
// boundary, L3/L4).

import { afterEach, describe, expect, it } from "vitest";

import { buildSessionOnboardingApp } from "./index.ts";
import type { RequestClient } from "./lib/machines/session-onboarding/index.ts";
import {
  createNoopFlowEventLog,
  type FlowEventLog,
} from "./lib/persistence/redis.ts";
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

interface Scenario {
  app: ReturnType<typeof buildSessionOnboardingApp>;
  eventLog: FlowEventLog;
}

function buildScenario(opts: { requestClient: RequestClient }): Scenario {
  const eventLog = createNoopFlowEventLog();
  const app = buildSessionOnboardingApp({
    eventLog,
    config: makeTestConfig(),
    requestClient: opts.requestClient,
    logTransition: () => undefined,
  });
  return { app, eventLog };
}

interface BeginResult {
  flow_id: string;
  correlation_id: string;
  state: string;
  context: {
    user: { email: string | null; display_name: string | null; first_name: string | null };
    org: { id: string | null; name: string | null };
    underlying_cause_tag: string | null;
  };
}

async function begin(
  app: Scenario["app"],
  opts: {
    userId: string;
    bearer: string;
    /** The `X-Org-Id` claim auth-proxy injects — AUDIT-ONLY now (the [hasOrg]
     *  decision comes from the backend `/api/orgs/me`, driven by the mock fetch).
     *  Sent here only to exercise the audit path; it does not drive the outcome. */
    orgId?: string;
    existing_org_names?: string[];
  },
): Promise<BeginResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "X-User-Id": opts.userId,
    authorization: `Bearer ${opts.bearer}`,
  };
  if (opts.orgId !== undefined) {
    headers["X-Org-Id"] = opts.orgId;
  }
  const res = await app.fetch(
    new Request("http://t/flow/session-onboarding/begin", {
      method: "POST",
      headers,
      body: JSON.stringify({
        existing_org_names: opts.existing_org_names,
      }),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as BeginResult;
}

let active: Scenario | null = null;
afterEach(() => {
  active = null;
});

// ── Spec 1 — Returning user with an org lands ready (NEW [hasOrg] branch) ──
// The org-source is the backend (`GET /api/orgs/me`, the org SSOT), loaded
// during `verifying` — NOT the `X-Org-Id` header (audit-only). The backend
// returns the org NAME, so session_started carries `org={id, name}`.
describe("Spec 1: returning user with an org lands ready", () => {
  it("emits session_started{user, org} from the backend org lookup and projects ready with user populated", async () => {
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

  it("records exactly one session_started event carrying the verified user + the backend org", async () => {
    active = buildScenario({ requestClient: returningFetch() });
    await begin(active.app, { userId: "u1", bearer: "tok-1", orgId: "org-1" });

    const events = await active.eventLog.read("session-onboarding:u1");
    const started = events.filter((e) => e.type === "session_started");
    expect(started).toHaveLength(1);
    expect(started[0].payload).toMatchObject({
      user: { email: "maya@acme", display_name: "Maya Chen" },
      org: { id: "org-1", name: "Acme Data" },
    });
  });
});

// ── Spec 2 — New user with no org reaches needs_org (defect-closing) ──
// Backend /api/orgs/me 404 → new user → org:null → needs_org.
describe("Spec 2: new user with no org reaches needs_org with identity populated", () => {
  it("emits session_started{user, org:null} and projects needs_org with email non-null", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const proj = await begin(active.app, { userId: "u2", bearer: "tok-2" });

    expect(proj.state).toBe("needs_org");
    expect(proj.context.org.id).toBeNull();
    // THE bug: this was null end-to-end before the realignment.
    expect(proj.context.user.email).toBe("maya@acme");
    expect(proj.context.user.display_name).toBe("Maya Chen");
  });

  it("ignores the X-Org-Id header for the decision (audit-only): backend 404 → needs_org even when X-Org-Id is present", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const proj = await begin(active.app, {
      userId: "u2",
      bearer: "tok-2",
      orgId: "org-stale-claim",
    });

    // The backend (404) is authoritative; the stale X-Org-Id claim does NOT
    // drive the user to ready.
    expect(proj.state).toBe("needs_org");
    expect(proj.context.org.id).toBeNull();
  });
});

// ── Spec 3 — Re-verification failure → session_rejected (NEW rejection path) ──
describe("Spec 3: re-verification failure rejects the session", () => {
  it("projects session_rejected over HTTP 200 with no session_started and no user state", async () => {
    active = buildScenario({ requestClient: rejectingFetch("tok-bad") });
    const proj = await begin(active.app, { userId: "u3", bearer: "tok-bad" });

    expect(proj.state).toBe("session_rejected");
    expect(proj.context.underlying_cause_tag).toBeTruthy();
    expect(proj.context.user.email).toBeNull();

    const events = await active.eventLog.read("session-onboarding:u3");
    expect(events.some((e) => e.type === "session_started")).toBe(false);
    expect(events.some((e) => e.type === "session_rejected")).toBe(true);
  });
});

// ── Spec 4 — Org submission from needs_org reaches ready (preserved) ──
describe("Spec 4: org submission from needs_org reaches ready", () => {
  it("creates the org, reaches ready, and the user stays populated", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });
    expect(beginProj.state).toBe("needs_org");

    const res = await active.app.fetch(
      new Request("http://t/flow/session-onboarding/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          machine: "session-onboarding",
          flow_id: beginProj.flow_id,
          type: "org_form_submitted",
          payload: { org_name: "Acme Data" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const proj = (await res.json()) as BeginResult;
    expect(proj.state).toBe("ready");
    expect(proj.context.org.id).toBe("org-1");
    // user carried from session_started, not re-fetched.
    expect(proj.context.user.email).toBe("maya@acme");
  });
});

// ── Spec 5 — Invalid org name keeps needs_org (preserved, renamed state) ──
describe("Spec 5: invalid org name keeps needs_org", () => {
  it("surfaces a validation error and stays in needs_org", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const res = await active.app.fetch(
      new Request("http://t/flow/session-onboarding/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          machine: "session-onboarding",
          flow_id: beginProj.flow_id,
          type: "org_form_submitted",
          payload: { org_name: "" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const proj = (await res.json()) as BeginResult & {
      context: { org_validation_error: { kind: string } | null };
    };
    expect(proj.state).toBe("needs_org");
    expect(proj.context.org_validation_error?.kind).toBe("empty");
    expect(proj.context.org.id).toBeNull();
  });
});

// ── Legacy-path alias — login-and-org-setup must still resolve (LEAF-2) ──
describe("Legacy alias: /flow/session-onboarding accepts the legacy machine name on /event", () => {
  it("resolves the legacy login-and-org-setup machine name without 404", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const res = await active.app.fetch(
      new Request("http://t/flow/session-onboarding/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          machine: "login-and-org-setup",
          flow_id: beginProj.flow_id,
          type: "org_form_submitted",
          payload: { org_name: "Acme Data" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const proj = (await res.json()) as BeginResult;
    expect(proj.state).toBe("ready");
  });

  it("does not 404 on the legacy /flow/login-and-org-setup HTTP path", async () => {
    // Returning user (backend /api/orgs/me reports an org) → [hasOrg] → ready.
    active = buildScenario({ requestClient: returningFetch() });
    const res = await active.app.fetch(
      new Request("http://t/flow/login-and-org-setup/begin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-User-Id": "u1",
          authorization: "Bearer tok-1",
        },
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(200);
    const proj = (await res.json()) as BeginResult;
    expect(proj.state).toBe("ready");
  });
});
