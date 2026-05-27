/**
 * Tests for the auth-proxy Hono app's cross-cutting surfaces — KPI event
 * emission on `/ui-state/*`, the test-mirror endpoint, the SLOW_MODE delay
 * harness, and (after Stage 1 lands) `verifyToken` dispatch for the new
 * user-token kid.
 *
 * | # | Group | Scenario | Status |
 * |---|---|---|---|
 * | 1 | KPI K3 | emits `silent_reauth_ok` when projection returns ready with `silent_reauth_ok` flag | ✓ existing |
 * | 2 | KPI K3 | emits `silent_reauth_failed` when projection returns `error_recoverable` with `silent-reauth-failed` tag | ✓ existing |
 * | 3 | KPI K3 | emits `auth_retry_clicked` when caller forwards a `retry_clicked` event | ✓ existing |
 * | 4 | test-mirror | captures the most-recent `Authorization` header on `/ui-state/*` and returns it via `GET /test/last-seen-authorization` | ✓ existing |
 * | 5 | test-mirror | returns 404 from `GET /test/last-seen-authorization` when `AUTH_MODE=production` | ✓ existing |
 * | 6 | SLOW_MODE | delays `/ui-state/*` responses by `SLOW_MODE_DELAY_MS` when set | ✓ existing |
 * | 7 | SLOW_MODE | does NOT delay when `SLOW_MODE_DELAY_MS` is unset | ✓ existing |
 * | 8 | SLOW_MODE | ignores `SLOW_MODE_DELAY_MS` when `AUTH_MODE=production` | ✓ existing |
 *
 * **Notes for the agent:**
 * - Behavior budget for this file (B4): 1 behavior × 2 = 2 tests max per behavior. Variations of the same behavior are parametrized. New scenarios should respect the same budget — keep verifyToken to one happy-path + one failure per kid.
 *
 * **ADR-043 audit (silent-reauth KPI receiving surface) — 2026-05-27:**
 * The auth-proxy's emit branches for `silent_reauth_ok` (state=ready +
 * `context.silent_reauth_ok===true`) and `silent_reauth_failed` (state=
 * error_recoverable + `tag==="silent-reauth-failed"`) remain in place and
 * are pinned by the KPI K3 tests above. ADR-043 retired ui-state's silent-
 * reauth subsystem, and ui-state's own contract test
 * (`derive-projection.contract.test.ts:303-305`) explicitly pins
 * `context.silent_reauth_ok` as NOT set today by fold or derive. The
 * `silent-reauth-failed` underlying-cause tag remains a closed-union
 * member of `UnderlyingCauseTag` (ui-state/.../domain.ts) but no
 * production code path emits it — only the harness `__force_failure__`
 * event in the ui-state contract test. The auth-proxy receiving surface
 * is therefore **latent**: byte-stable contract pin, no production
 * emitter today. Retiring it (and the tests) would span two services and
 * is left for a follow-up design decision.
 */

// Per ADR-030 §SD4 the auth-proxy emits three JSON events to stdout when it
// observes ui-state transitions:
//
//   - auth_recoverable_error_shown  — upstream returned state=error_recoverable
//   - auth_retry_clicked            — caller forwarded a retry_clicked event
//   - ready_reached                 — upstream returned state=ready
//
// Each event carries the request_id from the projection envelope and
// the underlying_cause_tag where relevant.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the JWKS resolver is mocked — it would otherwise reach out to the
// network at module load. Real `jose.SignJWT` / `jose.jwtVerify` /
// `jose.decodeProtectedHeader` are preserved so the kid-dispatch tests
// below can mint real tokens through `lib/m2m.ts`, `lib/pat.ts`, and
// `lib/user-token.ts` and exercise the real verifyToken path end-to-end.
vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof import("jose")>("jose");
  return {
    ...actual,
    createRemoteJWKSet: vi.fn(() => vi.fn()),
  };
});

import { app } from "./app.ts";
import { verifyToken } from "./lib/auth.ts";
import { _resetForTests as resetM2m, issueM2mToken } from "./lib/m2m.ts";
import { issuePat } from "./lib/pat.ts";
import { mintUserToken } from "./lib/user-token.ts";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeRequest(path: string, init: RequestInit = {}) {
  return app.fetch(new Request(`http://localhost${path}`, init));
}

interface CapturedEvent {
  event: string;
  request_id?: string;
  underlying_cause_tag?: string;
}

function captureStdout(): {
  events: CapturedEvent[];
  restore: () => void;
} {
  const events: CapturedEvent[] = [];
  const real = process.stdout.write.bind(process.stdout);
  const spy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: unknown) => {
      const text = typeof chunk === "string" ? chunk : (chunk as Buffer).toString("utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as CapturedEvent;
          if (typeof parsed.event === "string") {
            events.push(parsed);
          }
        } catch {
          // Not our JSON line — ignore (e.g. server startup logs).
        }
      }
      return true;
    });
  return {
    events,
    restore: () => {
      spy.mockRestore();
      void real;
    },
  };
}

describe("KPI K3 event emission on /ui-state/* (B4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_MODE = "dev";
  });

  it.each<[string, Record<string, unknown>, string, string | undefined]>([
    [
      "auth_recoverable_error_shown",
      {
        state: "error_recoverable",
        request_id: "R-7a4f-901c",
        context: { underlying_cause_tag: "partial-setup" },
      },
      "/ui-state/flow/login-and-org-setup/begin",
      "partial-setup",
    ],
    [
      "ready_reached",
      {
        state: "ready",
        request_id: "R-7a4f-901c",
        context: {},
      },
      "/ui-state/flow/login-and-org-setup/event",
      undefined,
    ],
  ])(
    "emits %s on matching upstream response",
    async (expectedEventName, upstreamBody, path, expectedTag) => {
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(upstreamBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

      const capture = captureStdout();
      try {
        const res = await makeRequest(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ persona_email: "maya@x" }),
        });
        expect(res.status).toBe(200);
      } finally {
        capture.restore();
      }

      const matching = capture.events.find(
        (e) => e.event === expectedEventName,
      );
      expect(matching).toBeDefined();
      expect(matching?.request_id).toBe("R-7a4f-901c");
      if (expectedTag) {
        expect(matching?.underlying_cause_tag).toBe(expectedTag);
      }
    },
  );

  // ------------------------------------------------------------------------
  // Step 03-01 — silent reauth KPI events (US-005)
  // ------------------------------------------------------------------------
  //
  // The auth-proxy observes the projection coming back from the ui-state
  // tier and emits an additional pair of KPI events for the silent-reauth
  // outcome:
  //   - state === "ready"             AND context.silent_reauth_ok === true
  //       → silent_reauth_ok
  //   - state === "error_recoverable" AND context.underlying_cause_tag
  //                                       === "silent-reauth-failed"
  //       → silent_reauth_failed
  //
  // Behavior budget extension: B5 (ok) + B6 (failed) = 2 behaviors × 2 = 4 tests max.

  it("emits silent_reauth_ok when projection returns ready with silent_reauth_ok flag", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          state: "ready",
          request_id: "R-chat-9b2a",
          context: { silent_reauth_ok: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const capture = captureStdout();
    try {
      const res = await makeRequest(
        "/ui-state/flow/login-and-org-setup/event",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ flow_id: "f-1", type: "THAW" }),
        },
      );
      expect(res.status).toBe(200);
    } finally {
      capture.restore();
    }
    const matching = capture.events.find((e) => e.event === "silent_reauth_ok");
    expect(matching).toBeDefined();
    expect(matching?.request_id).toBe("R-chat-9b2a");
  });

  it("emits silent_reauth_failed when projection returns error_recoverable with silent-reauth-failed tag", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          state: "error_recoverable",
          request_id: "R-chat-9b2a",
          context: { underlying_cause_tag: "silent-reauth-failed" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const capture = captureStdout();
    try {
      const res = await makeRequest(
        "/ui-state/flow/login-and-org-setup/event",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ flow_id: "f-1", type: "THAW" }),
        },
      );
      expect(res.status).toBe(200);
    } finally {
      capture.restore();
    }
    const matching = capture.events.find(
      (e) => e.event === "silent_reauth_failed",
    );
    expect(matching).toBeDefined();
    expect(matching?.request_id).toBe("R-chat-9b2a");
    expect(matching?.underlying_cause_tag).toBe("silent-reauth-failed");
  });

  it("emits auth_retry_clicked when caller forwards a retry_clicked event", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          state: "creating_org",
          request_id: "R-7a4f-901c",
          context: {},
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    const capture = captureStdout();
    try {
      const res = await makeRequest(
        "/ui-state/flow/login-and-org-setup/event",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            flow_id: "f-1",
            type: "retry_clicked",
          }),
        },
      );
      expect(res.status).toBe(200);
    } finally {
      capture.restore();
    }

    const matching = capture.events.find((e) => e.event === "auth_retry_clicked");
    expect(matching).toBeDefined();
    expect(matching?.request_id).toBe("R-7a4f-901c");
  });
});

// ----------------------------------------------------------------------------
// Step 02-01 (Phase 02) — Test-mirror endpoint for forwarded Authorization
// ----------------------------------------------------------------------------
//
// DD-10 (Phase 02): the frontend-coexistence acceptance suite needs to verify
// DWD-1's bearer-forwarding contract end-to-end. Auth-proxy captures the most-
// recent `Authorization` header observed on `/ui-state/*` proxy calls into a
// module-scoped cell and exposes it via `GET /test/last-seen-authorization`.
// The endpoint is dev-mode gated: in production it returns 404 so the test
// surface never leaks into deployed environments.
//
// Behavior budget for this section: 2 behaviors × 2 = 4 tests max.
//   B7: Capture & read the most-recent Authorization on /ui-state/* requests
//   B8: Production gate (404)
// Three tests below cover (a) capture+read, (b) empty cell, (c) production gate.

describe("test-mirror endpoint /test/last-seen-authorization (B7, B8)", () => {
  const originalAuthMode = process.env.AUTH_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_MODE = "dev";
    // Each test runs against the shared module-scoped cell; reset it by
    // hitting the endpoint once to read+ignore (or by re-importing — but
    // vitest caches modules). Empty-cell test relies on a fresh value
    // distinct from the prior capture test's marker. Using a unique marker
    // per test (UUID-like string) avoids the need to reset the cell.
    mockFetch.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
    } else {
      process.env.AUTH_MODE = originalAuthMode;
    }
  });

  it("captures the most-recent Authorization header on /ui-state/* and returns it via GET /test/last-seen-authorization", async () => {
    // Use a marker unique to this test so we don't observe a value left by
    // earlier tests in the module-scoped cell.
    const marker = "Bearer probe-02-01-capture-marker-9b2a4c";

    const proxied = await makeRequest("/ui-state/flow/login-and-org-setup/begin", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: marker,
      },
      body: JSON.stringify({ persona_email: "maya@x" }),
    });
    expect(proxied.status).toBe(200);

    const mirror = await makeRequest("/test/last-seen-authorization");
    expect(mirror.status).toBe(200);
    const body = await mirror.text();
    expect(body).toBe(marker);
  });

  it("returns 404 from GET /test/last-seen-authorization when AUTH_MODE=production", async () => {
    process.env.AUTH_MODE = "production";
    const mirror = await makeRequest("/test/last-seen-authorization");
    expect(mirror.status).toBe(404);
  });
});

// ----------------------------------------------------------------------------
// Step 04-01 (Phase 04) — SLOW_MODE_DELAY_MS induction mechanism (DD-18)
// ----------------------------------------------------------------------------
//
// The frontend-coexistence Phase 04 acceptance suite verifies the loader
// timeout invariant (DD-16). To deterministically induce a slow upstream the
// auth-proxy's `/ui-state/*` handler observes the `SLOW_MODE_DELAY_MS` env
// var and sleeps the configured ms BEFORE proceeding when set in a non-
// production AUTH_MODE. Production-gated so this surface cannot leak into
// deployed environments.
//
// Behavior budget for this section: 2 behaviors × 2 = 4 tests max.
//   B9: When set in dev mode, /ui-state/* delays by the configured ms.
//   B10: Production gate / unset gate — no delay when off.
// Three tests below cover (a) delay-on, (b) delay-off (unset), (c) prod gate.

describe("SLOW_MODE_DELAY_MS on /ui-state/* (frontend-coexistence Slice-4)", () => {
  const originalSlowMode = process.env.SLOW_MODE_DELAY_MS;
  const originalAuthMode = process.env.AUTH_MODE;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    if (originalSlowMode === undefined) {
      delete process.env.SLOW_MODE_DELAY_MS;
    } else {
      process.env.SLOW_MODE_DELAY_MS = originalSlowMode;
    }
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
    } else {
      process.env.AUTH_MODE = originalAuthMode;
    }
  });

  it("delays /ui-state/* responses by SLOW_MODE_DELAY_MS when set", async () => {
    process.env.SLOW_MODE_DELAY_MS = "200";
    process.env.AUTH_MODE = "dev";
    const { app: freshApp } = await import("./app.ts");
    const start = Date.now();
    const res = await freshApp.fetch(
      new Request(
        "http://localhost/ui-state/flow/login-and-org-setup/projection",
        { method: "GET" },
      ),
    );
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  it("does not delay when SLOW_MODE_DELAY_MS is unset", async () => {
    delete process.env.SLOW_MODE_DELAY_MS;
    process.env.AUTH_MODE = "dev";
    const { app: freshApp } = await import("./app.ts");
    const start = Date.now();
    const res = await freshApp.fetch(
      new Request(
        "http://localhost/ui-state/flow/login-and-org-setup/projection",
        { method: "GET" },
      ),
    );
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(100);
  });

  it("ignores SLOW_MODE_DELAY_MS when AUTH_MODE=production", async () => {
    process.env.SLOW_MODE_DELAY_MS = "500";
    process.env.AUTH_MODE = "production";
    process.env.WORKOS_CLIENT_ID = "test-workos-client";
    // Production branch requires a verified Bearer. A user-token's kid
    // dispatch bypasses the JWKS path entirely (verifyToken's local-kid
    // branch matches before fallthrough), so a real-minted user-token
    // authenticates in production mode without any jose stubbing. Mint
    // from the freshly re-imported module so the in-memory keypair the
    // fresh app uses matches the one that signed the token.
    const { mintUserToken: freshMint } = await import("./lib/user-token.ts");
    const { token } = await freshMint({
      sub: "u-1",
      email: "u@x",
      name: "U",
      org_id: "o-1",
      sid: "sid-1",
    });
    const { app: freshApp } = await import("./app.ts");
    const start = Date.now();
    const res = await freshApp.fetch(
      new Request(
        "http://localhost/ui-state/flow/login-and-org-setup/projection",
        {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        },
      ),
    );
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(100);
    delete process.env.WORKOS_CLIENT_ID;
  });
});

// ----------------------------------------------------------------------------
// verifyToken kid dispatch (B11)
// ----------------------------------------------------------------------------
//
// The auth-proxy ingress verifier (`lib/auth.ts:verifyToken`) dispatches by
// the `kid` header on the inbound JWT. Three local kids verify against the
// shared auth-proxy keypair without any network round-trip:
//
//   auth-proxy:m2m:1   → verifyM2mToken    (lib/m2m.ts)
//   auth-proxy:pat:1   → verifyPatToken    (lib/pat.ts)
//   auth-proxy:user:1  → verifyUserToken   (lib/user-token.ts)
//
// Anything else falls through to the JWKS resolver. These tests pin that
// dispatch contract directly at the verifyToken boundary — minting real
// tokens through the shared keypair and asserting the {userId, orgId, email}
// shape returned by each verifier path.

describe("verifyToken kid dispatch (B11)", () => {
  beforeEach(() => {
    resetM2m();
    process.env.AUTH_MODE = "dev";
  });

  afterEach(() => {
    resetM2m();
  });

  describe.each([
    {
      kind: "M2M",
      mint: async () =>
        (
          await issueM2mToken({
            sub: "svc-1",
            orgId: "org-m2m",
            email: "m2m@example.com",
          })
        ).token,
      expected: {
        userId: "svc-1",
        orgId: "org-m2m",
        email: "m2m@example.com",
      },
    },
    {
      kind: "PAT",
      mint: async () =>
        (
          await issuePat(
            { sub: "user-pat", orgId: "org-pat", email: "pat@example.com" },
            { name: "test-pat" },
          )
        ).token,
      expected: {
        userId: "user-pat",
        orgId: "org-pat",
        email: "pat@example.com",
      },
    },
    {
      kind: "user-token",
      mint: async () =>
        (
          await mintUserToken({
            sub: "user-abc",
            email: "alice@example.com",
            name: "Alice",
            org_id: "org-1",
            sid: "sid-xyz",
          })
        ).token,
      expected: {
        userId: "user-abc",
        orgId: "org-1",
        email: "alice@example.com",
      },
    },
  ])("kid=$kind", ({ mint, expected }) => {
    it("dispatches to the local verifier and returns the claim identity", async () => {
      const token = await mint();
      const result = await verifyToken(token);
      expect(result).toEqual(expected);
    });
  });

  it("falls through to the JWKS resolver for tokens with non-local kids", async () => {
    const { createRemoteJWKSet, generateKeyPair, SignJWT } = await import(
      "jose"
    );
    const { privateKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "unknown:kid:1" })
      .setSubject("u")
      .setIssuer("http://localhost:8000")
      .setAudience("dev-client")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const createJwksSpy = vi.mocked(createRemoteJWKSet);
    createJwksSpy.mockClear();

    await expect(verifyToken(forged)).rejects.toThrow();

    // Proves dispatch fell through past every local-kid branch into the JWKS
    // resolver path. The stubbed resolver yields no keys so verification
    // cannot succeed — but the attempt to consult JWKS is what pins
    // exhaustive dispatch.
    expect(createJwksSpy).toHaveBeenCalled();
  });
});

// ----------------------------------------------------------------------------
// user-token Bearer at protected endpoint (B12)
// ----------------------------------------------------------------------------
//
// HTTP-layer parity with the M2M and PAT issuance round-trips: a user-token
// Bearer at `/api/projects` must (a) strip any client-supplied identity
// headers, (b) inject the verified identity from the token's claims into
// the upstream request, and (c) reach the upstream proxy fetch.

describe("user-token Bearer at protected endpoint (B12)", () => {
  beforeEach(() => {
    resetM2m();
    vi.clearAllMocks();
    process.env.AUTH_MODE = "dev";
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    resetM2m();
  });

  it("forwards token-derived identity headers and strips client-supplied ones", async () => {
    const { token } = await mintUserToken({
      sub: "user-bob",
      email: "bob@example.com",
      name: "Bob",
      org_id: "org-2",
      sid: "sid-bob",
    });

    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-User-Id": "attacker",
          "X-Org-Id": "evil-org",
          "X-User-Email": "attacker@evil.example",
        },
      }),
    );
    expect(res.status).toBe(200);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [unknown, RequestInit];
    const headers = init.headers as Headers;
    expect({
      userId: headers.get("X-User-Id"),
      orgId: headers.get("X-Org-Id"),
      email: headers.get("X-User-Email"),
    }).toEqual({
      userId: "user-bob",
      orgId: "org-2",
      email: "bob@example.com",
    });
  });

  it("returns 401 when the user-token signature has been tampered", async () => {
    const { token } = await mintUserToken({
      sub: "user-bob",
      email: "bob@example.com",
      name: "Bob",
      org_id: "org-2",
      sid: "sid-bob",
    });
    const [header, payload, sig] = token.split(".");
    const tampered = `${header}.${payload}.${
      sig.startsWith("A") ? "B" : "A"
    }${sig.slice(1)}`;

    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Authorization: `Bearer ${tampered}` },
      }),
    );
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
