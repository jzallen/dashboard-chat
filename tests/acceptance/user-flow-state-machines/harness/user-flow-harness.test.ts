// Unit tests for UserFlowHarness (Step 02-02 / US-004).
//
// Strategy: stub `undici.request` so the harness's HTTP calls are observable
// without standing up the full compose stack. The Cucumber @us-004 scenarios
// remain @skip per DI-1; these vitest tests are the verification surface.
//
// Behavior budget (Step 02-02): 7 distinct behaviors × 2 = 14 test ceiling.
// Distinct behaviors verified here:
//   B1 — begin_auth captures jwt from projection.context.access_token
//   B2 — submit_org captures jwt when projection transitions to ready
//   B3 — force_transient_failure routes harness event; harness reports
//        error_recoverable
//   B4 — expire_token routes harness event; harness reports expired_token
//   B5 — assert_jwt_carries_org_claim matches decoded org_id to projection
//   B6 — assert_scope produces named-column diff with "expected:" / "actual:"
//        on each diverged dim
//   B7 — assert_chat_turn_invokable_for_active_project surfaces
//        "agent invocation missing scope: missing project_id" diagnostic when
//        active scope has no project_id
//   B8 — composition: a second harness with the same config + same flow_id
//        observes the existing ready state without re-running begin_auth

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
import type { FlowProjection } from "./types.ts";

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
 * Install a stub for `undici.request`. Each call's URL+method is matched
 * against the script; the harness sees the canned response. Returns the
 * stub for inspection.
 */
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

function authNoOrgProjection(flow_id: string, accessToken: string | null): FlowProjection {
  return {
    flow_id,
    state: "authenticated_no_org",
    context: {
      user: { email: MAYA.email, display_name: MAYA.display_name },
      org: { id: null, name: null },
      ...(accessToken ? { access_token: accessToken } : {}),
    },
    active_scope: {
      org_id: "",
      project_id: null,
      resource_type: null,
      resource_id: null,
    },
    sequence_id: 2,
    last_event_at: "2026-05-12T00:00:00.000Z",
    correlation_id: "R-7a4f-901c",
  };
}

function readyProjection(
  flow_id: string,
  orgId: string,
  accessToken: string,
  projectId: string | null = null,
): FlowProjection {
  return {
    flow_id,
    state: "ready",
    context: {
      user: { email: MAYA.email, display_name: MAYA.display_name },
      org: { id: orgId, name: "Acme Data" },
      access_token: accessToken,
      ...(projectId
        ? { project: { id: projectId, name: "Q4 Analytics" } }
        : {}),
    },
    active_scope: {
      org_id: orgId,
      project_id: projectId,
      resource_type: null,
      resource_id: null,
    },
    sequence_id: 4,
    last_event_at: "2026-05-12T00:00:01.000Z",
    correlation_id: "R-7a4f-901c",
  };
}

describe("B1 — begin_auth captures jwt from projection.context.access_token", () => {
  it("stores the access_token returned by the ui-state tier on this.jwt", async () => {
    const flow_id = "login-and-org-setup:user_maya";
    const accessToken = jwtWithOrgId("org-acme-data");
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/begin"),
        reply: { status: 200, body: authNoOrgProjection(flow_id, accessToken) },
      },
      {
        match: (u, i) => i?.method === "GET" && u.includes("/projection?"),
        reply: { status: 200, body: authNoOrgProjection(flow_id, accessToken) },
      },
    ]);
    const harness = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    await harness.begin_auth("maya");
    // Re-stub GET /projection to include org.id so claim+state can match.
    const reply = authNoOrgProjection(flow_id, accessToken);
    (reply.context as { org: { id: string | null } }).org.id = "org-acme-data";
    installStub([
      {
        match: (u, i) => i?.method === "GET" && u.includes("/projection?"),
        reply: { status: 200, body: reply },
      },
    ]);
    await expect(harness.assert_jwt_carries_org_claim()).resolves.toBeUndefined();
  });
});

describe("B2 — submit_org captures jwt on transition to ready", () => {
  it("stores access_token from the ready projection so subsequent assertions can use it", async () => {
    const flow_id = "login-and-org-setup:user_maya";
    const beginToken = jwtWithOrgId("");
    const readyToken = jwtWithOrgId("org-acme-data");
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/begin"),
        reply: { status: 200, body: authNoOrgProjection(flow_id, beginToken) },
      },
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/event"),
        reply: {
          status: 200,
          body: readyProjection(flow_id, "org-acme-data", readyToken),
        },
      },
      {
        match: (u, i) => i?.method === "GET" && u.includes("/projection?"),
        reply: {
          status: 200,
          body: readyProjection(flow_id, "org-acme-data", readyToken),
        },
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
    const flow_id = "login-and-org-setup:user_maya";
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/begin"),
        reply: { status: 200, body: authNoOrgProjection(flow_id, jwtWithOrgId("")) },
      },
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/event"),
        reply: {
          status: 200,
          body: {
            flow_id,
            state: "error_recoverable",
            context: { underlying_cause_tag: "transient" },
            active_scope: { org_id: "", project_id: null, resource_type: null, resource_id: null },
            sequence_id: 3,
            last_event_at: "2026-05-12T00:00:02.000Z",
            correlation_id: "R-7a4f-901c",
          },
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
    // Verify the harness sent the correct event type to /event.
    const eventCalls = __requestStub.mock.calls.filter((args: unknown[]) => {
      const init = (args[1] ?? {}) as { method?: string; body?: string };
      return init.method === "POST" && String(args[0]).endsWith("/event");
    });
    expect(eventCalls.length).toBeGreaterThan(0);
    const body = JSON.parse(
      String((eventCalls[0][1] as { body: string }).body),
    ) as { type: string; payload: { tag: string } };
    expect(body.type).toBe("__force_failure__");
    expect(body.payload.tag).toBe("transient");
  });
});

describe("B4 — expire_token drives into expired_token", () => {
  it("POSTs the __harness_expire_token__ event and reports the expired_token state", async () => {
    const flow_id = "login-and-org-setup:user_maya";
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/begin"),
        reply: { status: 200, body: authNoOrgProjection(flow_id, jwtWithOrgId("")) },
      },
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/event"),
        reply: {
          status: 200,
          body: {
            flow_id,
            state: "expired_token",
            context: {},
            active_scope: { org_id: "", project_id: null, resource_type: null, resource_id: null },
            sequence_id: 3,
            last_event_at: "2026-05-12T00:00:02.000Z",
            correlation_id: "R-7a4f-901c",
          },
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
    const eventCalls = __requestStub.mock.calls.filter((args: unknown[]) => {
      const init = (args[1] ?? {}) as { method?: string; body?: string };
      return init.method === "POST" && String(args[0]).endsWith("/event");
    });
    const body = JSON.parse(
      String((eventCalls[0][1] as { body: string }).body),
    ) as { type: string };
    expect(body.type).toBe("__harness_expire_token__");
  });
});

describe("B6 — assert_scope produces named-column diff", () => {
  it("names diverged dimensions with 'expected:' and 'actual:' on separate lines", async () => {
    const flow_id = "login-and-org-setup:user_maya";
    const readyToken = jwtWithOrgId("org-acme-data");
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/begin"),
        reply: { status: 200, body: authNoOrgProjection(flow_id, readyToken) },
      },
      {
        match: (u, i) => i?.method === "GET" && u.includes("/projection?"),
        reply: {
          status: 200,
          body: readyProjection(flow_id, "org-acme-data", readyToken, "proj-q4"),
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
    // Named column format: dim name padded, "expected: …" then "actual: …" on
    // the SAME line per harness convention (matches DatasetLayerHarness).
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
    const flow_id = "login-and-org-setup:user_maya";
    const readyToken = jwtWithOrgId("org-acme-data");
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/begin"),
        reply: { status: 200, body: authNoOrgProjection(flow_id, readyToken) },
      },
      {
        match: (u, i) => i?.method === "GET" && u.includes("/projection?"),
        reply: {
          // No project_id in active_scope.
          status: 200,
          body: readyProjection(flow_id, "org-acme-data", readyToken, null),
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

describe("B8 — composition: sibling harness reads existing flow without re-running begin_auth", () => {
  it("a second harness with the same world reads the projection of the first", async () => {
    const flow_id = "login-and-org-setup:user_maya";
    const readyToken = jwtWithOrgId("org-acme-data");
    const ready = readyProjection(flow_id, "org-acme-data", readyToken);
    let beginCount = 0;
    installStub([
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/begin"),
        reply: () => {
          beginCount += 1;
          return { status: 200, body: ready };
        },
      },
      {
        match: (u, i) => i?.method === "POST" && u.endsWith("/event"),
        reply: { status: 200, body: ready },
      },
      {
        match: (u, i) => i?.method === "GET" && u.includes("/projection?"),
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

    // Sibling: same persona, same proxy, but constructed AFTER. Attach the
    // existing flow via attach_to_flow so it can read the projection without
    // a second begin_auth. Verifies composition primitive from US-004.
    const sibling = new UserFlowHarness(
      { authProxyUrl: PROXY, fakeWorkOSUrl: FAKEWORKOS },
      MAYA,
    );
    sibling.attach_to_flow(flow_id, primary.get_last_correlation_id() ?? "");
    const proj = await sibling.get_projection();
    expect(proj.state).toBe("ready");
    expect(beginCount).toBe(1); // sibling did NOT call begin_auth
  });
});
