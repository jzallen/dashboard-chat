// Unit tests for UserFlowHarness (Step 02-02 / US-004).
//
// Strategy: stub `undici.request` so the harness's HTTP calls are observable
// without standing up the full compose stack. The Cucumber @us-004 scenarios
// remain @skip per DI-1; these vitest tests are the verification surface.
//
// ADR-046 MR-6 — the harness now reads ONE `/state` document and writes ONE
// event surface, so the stubs match `GET /ui-state/state` and
// `POST /ui-state/state/events` instead of the three former per-machine mounts.
// The canned responses are `ChatAppStateDocument`s; each behavior reads its
// region slice exactly as the harness does.
//
// Behavior budget (Step 02-02): 7 distinct behaviors × 2 = 14 test ceiling.
// Distinct behaviors verified here:
//   B1 — begin_auth captures jwt from regions.onboarding.context.access_token
//   B2 — submit_org captures jwt when the onboarding region transitions to ready
//   B3 — force_transient_failure routes the __force_failure__ event; harness
//        reports error_recoverable
//   B4 — expire_token routes the __expire_token__ event; harness reports
//        expired_token
//   B5 — assert_jwt_carries_org_claim matches decoded org_id to the document
//   B6 — assert_scope produces named-column diff with "expected:" / "actual:"
//        on each diverged dim (reads the single top-level active_scope)
//   B7 — assert_chat_turn_invokable_for_active_project surfaces
//        "agent invocation missing scope: missing project_id" diagnostic when
//        the document's active scope has no project_id
//   B8 — composition: a second harness with the same config observes the
//        existing document without re-running begin_auth (session_begin)

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock undici.request before importing the harness so the harness's `import
// { request } from "undici"` binds to our stub. vi.hoisted ensures the mock
// installation runs before the harness module is evaluated.
const { __requestStub } = vi.hoisted(() => ({ __requestStub: vi.fn() }));
vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return { ...actual, request: __requestStub };
});

import { UserFlowHarness } from "./user-flow-harness.ts";
import type { ActiveScope, ChatAppStateDocument, RegionView } from "./types.ts";

const PROXY = "http://auth-proxy.test:1042";
const FAKEWORKOS = "http://fake-workos.test:14299";

const MAYA = {
  id: "user_maya",
  email: "maya.chen@acme-data.example",
  display_name: "Maya Chen",
};

/** Build a base64url segment for a fake JWT carrying the given org_id. */
function jwtWithOrgId(orgId: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ org_id: orgId })).toString(
    "base64url",
  );
  // The harness's decoder does not verify the signature, so "sig" is enough.
  return `${header}.${payload}.sig`;
}

interface StubResponse {
  status: number;
  body: unknown;
}

/**
 * Install a stub script onto the hoisted __requestStub. Each call's URL+method
 * is matched against the script; the harness sees the canned response.
 */
function installStub(
  script: Array<{
    match: (url: string, init?: { method?: string; body?: string }) => boolean;
    reply:
      | StubResponse
      | ((url: string, init?: { body?: string }) => StubResponse);
  }>,
): void {
  __requestStub.mockImplementation(async (url: unknown, init?: unknown) => {
    const u = String(url);
    const i = (init ?? {}) as { method?: string; body?: string };
    for (const entry of script) {
      if (entry.match(u, i)) {
        const r =
          typeof entry.reply === "function" ? entry.reply(u, i) : entry.reply;
        return {
          statusCode: r.status,
          body: {
            json: async () => r.body,
          },
        };
      }
    }
    throw new Error(`unmatched stub call: ${i.method ?? "GET"} ${u}`);
  });
}

beforeEach(() => {
  __requestStub.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const EMPTY_SCOPE: ActiveScope = {
  org_id: "",
  project_id: null,
  resource_type: null,
  resource_id: null,
};

const VERIFYING: RegionView = { state: "verifying", context: {} };

/** Assemble a ChatAppStateDocument from an onboarding region slice + the
 *  single top-level active_scope. The projectContext / sessionChat regions are
 *  filled with their initial slice (irrelevant to the J-001 onboarding tests). */
function makeDoc(opts: {
  onboarding: RegionView;
  active_scope?: ActiveScope;
  request_id?: string;
}): ChatAppStateDocument {
  return {
    phase: "onboarding",
    active_scope: opts.active_scope ?? { ...EMPTY_SCOPE },
    sequence_id: 4,
    last_event_at: "2026-05-12T00:00:01.000Z",
    request_id: opts.request_id ?? "R-7a4f-901c",
    regions: {
      onboarding: opts.onboarding,
      projectContext: VERIFYING,
      sessionChat: VERIFYING,
    },
  };
}

function authNoOrgDoc(accessToken: string | null): ChatAppStateDocument {
  return makeDoc({
    onboarding: {
      state: "authenticated_no_org",
      context: {
        user: { email: MAYA.email, display_name: MAYA.display_name },
        org: { id: null, name: null },
        ...(accessToken ? { access_token: accessToken } : {}),
      },
    },
    active_scope: { ...EMPTY_SCOPE },
  });
}

function readyDoc(
  orgId: string,
  accessToken: string,
  projectId: string | null = null,
): ChatAppStateDocument {
  return makeDoc({
    onboarding: {
      state: "ready",
      context: {
        user: { email: MAYA.email, display_name: MAYA.display_name },
        org: { id: orgId, name: "Acme Data" },
        access_token: accessToken,
        ...(projectId
          ? { project: { id: projectId, name: "Q4 Analytics" } }
          : {}),
      },
    },
    active_scope: {
      org_id: orgId,
      project_id: projectId,
      resource_type: null,
      resource_id: null,
    },
  });
}

/** Parse the JSON body of a POST /ui-state/state/events stub call. */
function eventBody(args: unknown[]): { type: string; payload?: Record<string, unknown> } {
  const init = (args[1] ?? {}) as { body?: string };
  return JSON.parse(String(init.body)) as {
    type: string;
    payload?: Record<string, unknown>;
  };
}

describe("B1 — begin_auth captures jwt from regions.onboarding.context.access_token", () => {
  it("stores the access_token returned by the ui-state tier on this.jwt", async () => {
    const accessToken = jwtWithOrgId("org-acme-data");
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/state/events"),
        reply: { status: 200, body: authNoOrgDoc(accessToken) },
      },
      {
        match: (u, i) => i?.method === "GET" && u.endsWith("/ui-state/state"),
        reply: { status: 200, body: authNoOrgDoc(accessToken) },
      },
    ]);
    const harness = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    await harness.begin_auth("maya");
    // Re-stub GET /state to include org.id so claim+state can match.
    const doc = authNoOrgDoc(accessToken);
    (doc.regions.onboarding.context as { org: { id: string | null } }).org.id =
      "org-acme-data";
    installStub([
      {
        match: (u, i) => i?.method === "GET" && u.endsWith("/ui-state/state"),
        reply: { status: 200, body: doc },
      },
    ]);
    await expect(harness.assert_jwt_carries_org_claim()).resolves.toBeUndefined();
  });
});

describe("B2 — submit_org captures jwt on transition to ready", () => {
  it("stores access_token from the ready document so subsequent assertions can use it", async () => {
    const beginToken = jwtWithOrgId("");
    const readyToken = jwtWithOrgId("org-acme-data");
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/state/events"),
        reply: (_u, i) => {
          const body = JSON.parse(String(i?.body ?? "{}")) as { type?: string };
          if (body.type === "session_begin") {
            return { status: 200, body: authNoOrgDoc(beginToken) };
          }
          return { status: 200, body: readyDoc("org-acme-data", readyToken) };
        },
      },
      {
        match: (u, i) => i?.method === "GET" && u.endsWith("/ui-state/state"),
        reply: { status: 200, body: readyDoc("org-acme-data", readyToken) },
      },
    ]);
    const harness = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    await harness.begin_auth("maya");
    await harness.submit_org("Acme Data");
    await expect(harness.assert_jwt_carries_org_claim()).resolves.toBeUndefined();
  });
});

describe("B3 — force_transient_failure drives into error_recoverable", () => {
  it("POSTs the __force_failure__ event and reports the recoverable-error state", async () => {
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/state/events"),
        reply: (_u, i) => {
          const body = JSON.parse(String(i?.body ?? "{}")) as { type?: string };
          if (body.type === "session_begin") {
            return { status: 200, body: authNoOrgDoc(jwtWithOrgId("")) };
          }
          return {
            status: 200,
            body: makeDoc({
              onboarding: {
                state: "error_recoverable",
                context: { underlying_cause_tag: "transient" },
              },
            }),
          };
        },
      },
    ]);
    const harness = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    await harness.begin_auth("maya");
    const proj = await harness.force_transient_failure("transient");
    expect(proj.state).toBe("error_recoverable");
    // Verify the harness sent the correct event type to /state/events.
    const failureCalls = __requestStub.mock.calls.filter((args: unknown[]) => {
      const init = (args[1] ?? {}) as { method?: string; body?: string };
      if (init.method !== "POST" || !String(args[0]).endsWith("/state/events")) {
        return false;
      }
      return eventBody(args).type === "__force_failure__";
    });
    expect(failureCalls.length).toBe(1);
    const body = eventBody(failureCalls[0]);
    expect(body.type).toBe("__force_failure__");
    expect(body.payload?.tag).toBe("transient");
  });
});

describe("B4 — expire_token drives into expired_token", () => {
  it("POSTs the __expire_token__ event and reports the expired_token state", async () => {
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/state/events"),
        reply: (_u, i) => {
          const body = JSON.parse(String(i?.body ?? "{}")) as { type?: string };
          if (body.type === "session_begin") {
            return { status: 200, body: authNoOrgDoc(jwtWithOrgId("")) };
          }
          return {
            status: 200,
            body: makeDoc({
              onboarding: { state: "expired_token", context: {} },
            }),
          };
        },
      },
    ]);
    const harness = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    await harness.begin_auth("maya");
    const proj = await harness.expire_token();
    expect(proj.state).toBe("expired_token");
    const expireCalls = __requestStub.mock.calls.filter((args: unknown[]) => {
      const init = (args[1] ?? {}) as { method?: string; body?: string };
      if (init.method !== "POST" || !String(args[0]).endsWith("/state/events")) {
        return false;
      }
      return eventBody(args).type === "__expire_token__";
    });
    expect(expireCalls.length).toBe(1);
  });
});

describe("B6 — assert_scope produces named-column diff", () => {
  it("names diverged dimensions with 'expected:' and 'actual:' over the top-level active_scope", async () => {
    const readyToken = jwtWithOrgId("org-acme-data");
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/state/events"),
        reply: { status: 200, body: authNoOrgDoc(readyToken) },
      },
      {
        match: (u, i) => i?.method === "GET" && u.endsWith("/ui-state/state"),
        reply: {
          status: 200,
          body: readyDoc("org-acme-data", readyToken, "proj-q4"),
        },
      },
    ]);
    const harness = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    await harness.begin_auth("maya");
    // Expected mismatches on project_id.
    let captured = "";
    try {
      await harness.assert_scope({
        org_id: "org-acme-data",
        project_id: "proj-q5",
      });
    } catch (e) {
      captured = (e as Error).message;
    }
    expect(captured).toContain("project_id");
    expect(captured).toContain("expected:");
    expect(captured).toContain("actual:");
    expect(captured).toContain("proj-q5");
    expect(captured).toContain("proj-q4");
    // Each diverged dim must be on its own line.
    const lines = captured.split("\n");
    const projLines = lines.filter((l) => l.includes("project_id"));
    expect(projLines.length).toBeGreaterThanOrEqual(1);
  });
});

describe("B7 — assert_chat_turn_invokable_for_active_project surfaces missing-scope diagnostic", () => {
  it("throws a test failure naming 'agent invocation missing scope: missing project_id' when active scope has no project_id", async () => {
    const readyToken = jwtWithOrgId("org-acme-data");
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/state/events"),
        reply: { status: 200, body: authNoOrgDoc(readyToken) },
      },
      {
        match: (u, i) => i?.method === "GET" && u.endsWith("/ui-state/state"),
        reply: {
          // No project_id in the document's top-level active_scope.
          status: 200,
          body: readyDoc("org-acme-data", readyToken, null),
        },
      },
      {
        // The agent endpoint would reject; the harness routes to it via
        // auth-proxy and surfaces the named diagnostic. Stub a 400 reply.
        match: (u, i) => i?.method === "POST" && u.includes("/agent/"),
        reply: {
          status: 400,
          body: {
            error: "agent invocation missing scope: missing project_id",
          },
        },
      },
    ]);
    const harness = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    await harness.begin_auth("maya");
    let captured = "";
    try {
      await harness.assert_chat_turn_invokable_for_active_project();
    } catch (e) {
      captured = (e as Error).message;
    }
    expect(captured).toContain("agent invocation missing scope");
    expect(captured).toContain("missing project_id");
  });
});

describe("B8 — composition: sibling harness reads existing document without re-running begin_auth", () => {
  it("a second harness with the same world reads the document of the first", async () => {
    const readyToken = jwtWithOrgId("org-acme-data");
    const ready = readyDoc("org-acme-data", readyToken);
    let beginCount = 0;
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/state/events"),
        reply: (_u, i) => {
          const body = JSON.parse(String(i?.body ?? "{}")) as { type?: string };
          if (body.type === "session_begin") {
            beginCount += 1;
          }
          return { status: 200, body: ready };
        },
      },
      {
        match: (u, i) => i?.method === "GET" && u.endsWith("/ui-state/state"),
        reply: { status: 200, body: ready },
      },
    ]);
    const primary = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    await primary.begin_auth("maya");
    await primary.submit_org("Acme Data");
    expect(beginCount).toBe(1);

    // Sibling: same persona, same proxy, but constructed AFTER. Attach to the
    // existing per-principal document via attach_to_flow so it can read the
    // document without a second begin_auth (session_begin). Verifies the
    // composition primitive from US-004.
    const sibling = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    sibling.attach_to_flow(primary.get_last_correlation_id() ?? "");
    const proj = await sibling.get_projection();
    expect(proj.state).toBe("ready");
    expect(beginCount).toBe(1); // sibling did NOT begin a new session
  });
});
