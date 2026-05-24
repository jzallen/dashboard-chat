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

import { probe } from "@dashboard-chat/shared-failure-simulation";
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
      body: JSON.stringify({}),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as BeginResult;
}

/**
 * Like `begin`, but carries an org-setup body — used to thread the
 * `force_reissue_failures` harness side-channel (gated by the failure-simulation
 * switch) so a scenario can drive the org-create reissue budget to exhaustion.
 */
async function beginWithBody(
  app: Scenario["app"],
  opts: { userId: string; bearer: string; body: Record<string, unknown> },
): Promise<BeginResult> {
  const res = await app.fetch(
    new Request("http://t/flow/session-onboarding/begin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-User-Id": opts.userId,
        authorization: `Bearer ${opts.bearer}`,
      },
      body: JSON.stringify(opts.body),
    }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as BeginResult;
}

/**
 * Post an event through the `/event` driving port (the ACL router) and return
 * the HTTP status + parsed projection. Mirrors the inline `app.fetch(...)` the
 * existing Specs use for `/event`, lifted to a helper so the `/event`-parity
 * scenarios read as Given/When/Then. `headers` lets a scenario supply the
 * verified-principal `X-User-Id` (the begin() helper already shows the header
 * pattern; the pre-parity `/event` Specs send none — that gap is what Slice 5
 * closes).
 */
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

/**
 * Enable / disable the failure-simulation gate for the `__force_failure__`
 * and `force_reissue_failures` harness side-channels (ADR-035).
 *
 * The gate verdict is a MODULE-SCOPED cache populated by `probe(env, service)`;
 * `shouldInject` (in the router) reads the cache, never re-parses env per
 * request. So a scenario that needs the harness side-channels ENABLED calls
 * `enableFailureSimulation()` (a dev-tier + flag-set probe); the production
 * default is the fail-closed verdict, which `disableFailureSimulation()`
 * restores. Because the cache is process-global, `afterEach` always restores
 * the disabled default so an enabled scenario cannot leak into the next.
 */
function enableFailureSimulation(): void {
  probe({ ENVIRONMENT: "ci", FAILURE_SIMULATION_ENABLED: "true" }, "ui-state");
}
function disableFailureSimulation(): void {
  probe({}, "ui-state");
}

let active: Scenario | null = null;
afterEach(() => {
  active = null;
  // The gate verdict cache is module-global; always restore the production
  // fail-closed default so an enabled scenario never bleeds into the next.
  disableFailureSimulation();
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

// ── Spec 7 — Globally-duplicate org name → inline duplicate error (NEW) ──
// Org names are globally unique (backend SSOT). A collision returns 409 from
// POST /api/orgs; the machine routes it to needs_org with the duplicate error.
describe("Spec 7: a taken org name keeps needs_org with a duplicate error", () => {
  it("maps the backend name-collision (409) to an inline duplicate error", async () => {
    active = buildScenario({
      requestClient: makeMockFetch({ profile: MAYA_PROFILE, orgNameTaken: true }),
    });
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
    const proj = (await res.json()) as BeginResult & {
      context: { org_validation_error: { kind: string } | null };
    };
    expect(proj.state).toBe("needs_org");
    expect(proj.context.org_validation_error?.kind).toBe("duplicate");
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

// ═══════════════════════════════════════════════════════════════════════════
// /event-to-/begin PARITY SLICE (DESIGN: event-slice-scope.md §4)
//
// Driving port: POST /flow/session-onboarding/event (the ACL router). Every
// scenario enters here and asserts at the projection / HTTP-status boundary —
// no internal-component access. The single test double is the mock `fetch` at
// the WorkOS / backend driven-port boundary (inherited from the Specs above).
//
// Slices 1-3 are CHARACTERIZATION (green now) — they pin currently-untested
// observable behavior of the existing `/event` handler so Slices 4-6 can edit
// it safely (Iron Rule / brownfield walking skeleton). Slices 4-6 are BEHAVIOR
// CHANGES marked `it.skip` — they encode the POST-implementation expectation;
// DELIVER un-skips one at a time (Outside-In: un-skip → RED → implement → GREEN).
// ═══════════════════════════════════════════════════════════════════════════

// ── Slice 1 — A malformed event without flow id or type is refused ──
// CHARACTERIZATION (green): the handler already refuses an event that names no
// flow or no type with a 400. The Slice-1 zod-DTO refactor (DELIVER) must
// PRESERVE this observable 400 contract — this test is what holds it in place.
describe("Slice 1: a malformed event missing its flow id or type is refused", () => {
  it("refuses an org-submission that names no flow", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const { status, body } = await postEvent(active.app, {
      type: "org_form_submitted",
      payload: { org_name: "Acme Data" },
    });

    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("refuses an event that names a flow but no event type", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const { status, body } = await postEvent(active.app, {
      flow_id: "session-onboarding:u2",
    });

    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it("accepts a well-formed org submission and reaches ready", async () => {
    // The success counterpart to the two refusals above — pins that a complete
    // command still settles through the same handler (Spec 4, restated at the
    // /event parity boundary so the DTO refactor cannot regress the happy path).
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });
    const { status, body } = await postEvent(active.app, {
      flow_id: beginProj.flow_id,
      type: "org_form_submitted",
      payload: { org_name: "Acme Data" },
    });

    expect(status).toBe(200);
    expect(body.state).toBe("ready");
  });
});

// ── Slice 2 — Retrying after a recoverable org-setup failure over /event ──
// CHARACTERIZATION (green): retry_clicked is exercised at the machine +
// orchestrator levels but NEVER through the /event HTTP transport. Drive a real
// recoverable failure (the org-create reissue budget is exhausted via the
// force_reissue_failures side-channel — the realistic "partial-setup" driver),
// then retry through /event.
//
// OBSERVABLE TRUTH (pinned empirically, not the seed's wish): the projection
// surfaces `error_recoverable` with the `partial-setup` cause; each retry over
// /event is ACCEPTED (200) and the flow REMAINS in the recoverable-error state.
// It does NOT surface `error_terminal` at the projection: there is no
// error_terminal reducer and no terminal event is emitted when the actor
// escalates, so the projection fold cannot reach it (see distill/upstream-issues
// .md — observability gap, not a contradiction). Pin what the user actually
// observes, per the Iron Rule.
describe("Slice 2: retrying after a recoverable org-setup failure keeps the recoverable-error screen", () => {
  it("lands on the recoverable-error screen when the org-setup reissue budget is exhausted", async () => {
    enableFailureSimulation();
    active = buildScenario({ requestClient: okFetch() });
    // Begin carrying the forced-reissue-failure budget so org-create exhausts
    // its internal reissue attempts and settles recoverable.
    const beginProj = await beginWithBody(active.app, {
      userId: "u2",
      bearer: "tok-2",
      body: { force_reissue_failures: 99 },
    });
    expect(beginProj.state).toBe("needs_org");

    const submitted = await postEvent(active.app, {
      flow_id: beginProj.flow_id,
      type: "org_form_submitted",
      payload: { org_name: "Acme Data" },
    });

    expect(submitted.status).toBe(200);
    expect(submitted.body.state).toBe("error_recoverable");
    expect((submitted.body.context as Record<string, unknown>).underlying_cause_tag).toBe(
      "partial-setup",
    );
  });

  it("accepts each retry over /event and keeps the user on the recoverable-error screen", async () => {
    enableFailureSimulation();
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await beginWithBody(active.app, {
      userId: "u2",
      bearer: "tok-2",
      body: { force_reissue_failures: 99 },
    });
    await postEvent(active.app, {
      flow_id: beginProj.flow_id,
      type: "org_form_submitted",
      payload: { org_name: "Acme Data" },
    });

    // Three user retries — each accepted over the HTTP transport, each leaving
    // the user on the recoverable-error screen (the budget keeps re-exhausting).
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const retried = await postEvent(active.app, {
        flow_id: beginProj.flow_id,
        type: "retry_clicked",
        payload: {},
      });
      expect(retried.status).toBe(200);
      expect(retried.body.state).toBe("error_recoverable");
    }
  });
});

// ── Slice 3 — The forced-failure side-channel is gated, both arms, over /event ──
// CHARACTERIZATION (green): the gate at the ACL has ZERO HTTP-layer coverage.
// Both arms are pinned. The gate verdict is a module-global cache populated by
// probe(); the production default is fail-closed (knob disabled), and
// enableFailureSimulation() opens it (dev/ci tier + flag). afterEach restores
// the disabled default.
describe("Slice 3: the forced-failure side-channel is gated unless the failure-simulation switch is on", () => {
  it("refuses a forced failure when the failure-simulation switch is off (production default)", async () => {
    // No enableFailureSimulation() call → the fail-closed production default.
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(active.app, {
      flow_id: beginProj.flow_id,
      type: "__force_failure__",
      payload: { tag: "transient" },
    });

    expect(status).toBe(403);
    expect(String(body.error)).toMatch(/failure-simulation/i);
    // The flow is untouched — no forced failure reached the actor.
    const stillNeedsOrg = await active.app.fetch(
      new Request(
        `http://t/flow/session-onboarding/projection?flow_id=${encodeURIComponent(beginProj.flow_id)}`,
        { method: "GET" },
      ),
    );
    const proj = (await stillNeedsOrg.json()) as BeginResult;
    expect(proj.state).toBe("needs_org");
  });

  it("routes a forced failure into the recoverable-error screen when the switch is on", async () => {
    enableFailureSimulation();
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });
    expect(beginProj.state).toBe("needs_org"); // the source state the machine handles

    const { status, body } = await postEvent(active.app, {
      flow_id: beginProj.flow_id,
      type: "__force_failure__",
      payload: { tag: "transient" },
    });

    expect(status).toBe(200);
    expect(body.state).toBe("error_recoverable");
    expect((body.context as Record<string, unknown>).underlying_cause_tag).toBe(
      "transient",
    );
  });
});

// ── Slice 4 — A forced-failure cause outside the failure vocabulary is refused ──
// BEHAVIOR CHANGE (RED). Today the gate passes any `__force_failure__` straight
// to the actor without checking its cause tag. After Slice 4 the ACL validates
// `payload.tag` against the domain's closed failure vocabulary (D-E2, reusing
// the widened-to-export `isUnderlyingCauseTag`): an unrecognized cause → 400, the
// projection UNCHANGED (still needs_org), nothing reaches the actor.
describe("Slice 4: a forced failure naming an unrecognized cause is refused at the boundary", () => {
  it("refuses a forced failure whose cause is not in the failure vocabulary", async () => {
    enableFailureSimulation();
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(active.app, {
      flow_id: beginProj.flow_id,
      type: "__force_failure__",
      payload: { tag: "not-a-cause" },
    });

    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/invalid_request/);

    // The projection is unchanged — the malformed forced failure never reached
    // the actor.
    const after = await active.app.fetch(
      new Request(
        `http://t/flow/session-onboarding/projection?flow_id=${encodeURIComponent(beginProj.flow_id)}`,
        { method: "GET" },
      ),
    );
    const proj = (await after.json()) as BeginResult;
    expect(proj.state).toBe("needs_org");
    expect(proj.context.underlying_cause_tag).toBeNull();
  });
});

// ── Slice 5 — An event's flow must belong to the verified principal ──
// BEHAVIOR CHANGE (RED). Today `/event` trusts the body `flow_id` and never
// reads the verified principal, so a caller can post to any flow (today this
// merely 500s for a nonexistent actor — the hole is real for an existing one).
// After Slice 5 the ACL derives `flow_id = session-onboarding:<verified
// X-User-Id>` and REJECTS a mismatched body flow_id with 403 (D-E3, OQ-E1
// ENFORCE). The matching-principal happy path is now authorized (Spec 4).
describe("Slice 5: an event is accepted only for the verified principal's own flow", () => {
  it("refuses an event whose flow belongs to a different principal", async () => {
    active = buildScenario({ requestClient: okFetch() });
    // The verified principal is u2 (their flow is begun and in needs_org).
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });
    expect(beginProj.state).toBe("needs_org");

    // u2 posts an event naming u9's flow.
    const { status } = await postEvent(
      active.app,
      {
        flow_id: "session-onboarding:u9",
        type: "org_form_submitted",
        payload: { org_name: "Acme Data" },
      },
      { "X-User-Id": "u2", authorization: "Bearer tok-2" },
    );

    expect(status).toBe(403);

    // No event reached u9's flow — u2's own flow is also untouched.
    const after = await active.app.fetch(
      new Request(
        `http://t/flow/session-onboarding/projection?flow_id=${encodeURIComponent(beginProj.flow_id)}`,
        { method: "GET" },
      ),
    );
    const proj = (await after.json()) as BeginResult;
    expect(proj.state).toBe("needs_org");
  });

  it("accepts an event for the verified principal's own flow and reaches ready", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(
      active.app,
      {
        flow_id: beginProj.flow_id,
        type: "org_form_submitted",
        payload: { org_name: "Acme Data" },
      },
      { "X-User-Id": "u2", authorization: "Bearer tok-2" },
    );

    expect(status).toBe(200);
    expect(body.state).toBe("ready");
  });
});

// ── Slice 6 — A malformed org-submission payload is refused at the boundary ──
// BEHAVIOR CHANGE (RED) for the well-formedness check; CONTRAST stays green for
// the domain rule. The whole point: the ACL checks the COMMAND is well-formed
// (is org_name a string at all?); the value object checks the DOMAIN rule (is
// the string a valid name?). Today an absent org_name slips through to the actor
// as a silent no-op (observed: it proceeds to creating_org). After Slice 6 an
// absent org_name → 400 at the boundary, while an empty STRING still settles to
// needs_org with the empty-name validation error (Spec 5 — the domain rule stays
// on the value object, NOT promoted to the ACL).
describe("Slice 6: a malformed org submission is refused while the empty-name domain rule stays in the model", () => {
  // RED until DELIVER Slice 6 — ACL well-formedness check (org_name must be a string).
  it.skip("refuses an org submission that carries no organization name", async () => {
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(active.app, {
      flow_id: beginProj.flow_id,
      type: "org_form_submitted",
      payload: {},
    });

    expect(status).toBe(400);
    expect(String(body.error)).toMatch(/invalid_request/);

    // The malformed command never reached the actor — the flow is unchanged.
    const after = await active.app.fetch(
      new Request(
        `http://t/flow/session-onboarding/projection?flow_id=${encodeURIComponent(beginProj.flow_id)}`,
        { method: "GET" },
      ),
    );
    const proj = (await after.json()) as BeginResult;
    expect(proj.state).toBe("needs_org");
  });

  it("still surfaces the empty-name validation error for an empty organization name (domain rule, unchanged)", async () => {
    // CONTRAST (stays green): an empty STRING is a well-formed command carrying
    // an invalid name — the value object's domain rule, NOT the ACL's
    // well-formedness check. This must keep working exactly as Spec 5 (a 200
    // with the empty-name inline error in needs_org), proving the rule was NOT
    // promoted to the boundary.
    active = buildScenario({ requestClient: okFetch() });
    const beginProj = await begin(active.app, { userId: "u2", bearer: "tok-2" });

    const { status, body } = await postEvent(active.app, {
      flow_id: beginProj.flow_id,
      type: "org_form_submitted",
      payload: { org_name: "" },
    });

    expect(status).toBe(200);
    expect(body.state).toBe("needs_org");
    expect(
      (body.context as { org_validation_error?: { kind?: string } })
        .org_validation_error?.kind,
    ).toBe("empty");
  });
});
