/**
 * Tests for the auth-proxy Hono app's cross-cutting surfaces — KPI event
 * emission on `/ui-state/*`, the test-mirror endpoint, the SLOW_MODE delay
 * harness, and `verifyToken` dispatch for the user-token kid.
 *
 * | # | Group | Scenario |
 * |---|---|---|
 * | 1 | KPI K3 | emits `auth_recoverable_error_shown` / `ready_reached` from the `/state` document onboarding region |
 * | 2 | test-mirror | captures the most-recent `Authorization` header on `/ui-state/*` and returns it via `GET /test/last-seen-authorization` |
 * | 3 | test-mirror | returns 404 from `GET /test/last-seen-authorization` when `AUTH_MODE=production` |
 * | 4 | SLOW_MODE | delays `/ui-state/*` responses by `SLOW_MODE_DELAY_MS` when set |
 * | 5 | SLOW_MODE | does NOT delay when `SLOW_MODE_DELAY_MS` is unset |
 * | 6 | SLOW_MODE | ignores `SLOW_MODE_DELAY_MS` when `AUTH_MODE=production` |
 *
 * **Notes for the agent:**
 * - Behavior budget for this file (B4): 1 behavior × 2 = 2 tests max per behavior. Variations of the same behavior are parametrized.
 */

// Per ADR-030 §SD4 the auth-proxy emits JSON events to stdout when it
// observes ui-state transitions. Both surviving K3 events read the UPSTREAM
// /state projection:
//
//   - auth_recoverable_error_shown  — upstream returned state=error_recoverable
//   - ready_reached                 — upstream returned state=ready
//
// (The inbound-keyed auth_retry_clicked trigger was retired in CDO-S4 once
// `retry_clicked` was removed from the closed wire union in CDO-S3; the retry
// funnel re-derives from `org_create.intercepted` per ADR-048 §5.)
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

import { decodeJwt } from "jose";

import { app } from "./app.ts";
import { verifyToken } from "./lib/auth.ts";
import { COOKIE_AUTH_TOKEN, COOKIE_SESSION_FLAG } from "./lib/cookies.ts";
import { _resetForTests as resetM2m, issueM2mToken } from "./lib/m2m.ts";
import { issuePat } from "./lib/pat.ts";
import {
  _resetForTests as resetSessionStore,
  getSession,
  setSession,
} from "./lib/session-store.ts";
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

  // ADR-046: the KPI sniffer reads the ChatApp `/state` document, whose
  // onboarding lifecycle lives at `regions.onboarding.state` (and the cause tag
  // at `regions.onboarding.context.underlying_cause_tag`), with `request_id`
  // hoisted to the document's top level. (The legacy per-machine flat envelope
  // was retired at MR-7 — `/state` is the sole read surface.)
  it.each<[string, Record<string, unknown>, string, string | undefined]>([
    [
      "auth_recoverable_error_shown",
      {
        phase: "onboarding",
        request_id: "R-doc-5c1a",
        regions: {
          onboarding: {
            state: "error_recoverable",
            context: { underlying_cause_tag: "partial-setup" },
          },
          projectContext: { state: "verifying", context: {} },
          sessionChat: { state: "verifying", context: {} },
        },
      },
      "/ui-state/state",
      "partial-setup",
    ],
    [
      "ready_reached",
      {
        phase: "project_context",
        request_id: "R-doc-5c1a",
        regions: {
          onboarding: { state: "ready", context: {} },
          projectContext: { state: "project_selected", context: {} },
          sessionChat: { state: "verifying", context: {} },
        },
      },
      "/ui-state/state/events",
      undefined,
    ],
  ])(
    "emits %s from the /state document onboarding region",
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
          body: JSON.stringify({ type: "org_form_submitted" }),
        });
        expect(res.status).toBe(200);
      } finally {
        capture.restore();
      }

      const matching = capture.events.find(
        (e) => e.event === expectedEventName,
      );
      expect(matching).toBeDefined();
      expect(matching?.request_id).toBe("R-doc-5c1a");
      if (expectedTag) {
        expect(matching?.underlying_cause_tag).toBe(expectedTag);
      }
    },
  );

  // The `auth_retry_clicked` inbound trigger test was removed in CDO-S4: the
  // `retry_clicked` wire event no longer exists (retired from the closed union
  // in CDO-S3), so its emitter is unreachable dead code. The surviving emitters
  // above key off the upstream /state projection, not the inbound event.
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

    const proxied = await makeRequest("/ui-state/state/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: marker,
      },
      body: JSON.stringify({ type: "session_begin" }),
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
        "http://localhost/ui-state/state",
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
        "http://localhost/ui-state/state",
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
        "http://localhost/ui-state/state",
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

// ----------------------------------------------------------------------------
// ui-cookie-session — cookie transport, identity & teardown (C1 + C2)
// ----------------------------------------------------------------------------
//
// Slices C1/C2 of the localStorage-Bearer → httpOnly-cookie-session migration
// (design SSOT: docs/feature/ui-cookie-session/design/delta-and-decisions.md).
// These pin the auth-proxy contract end to end at the HTTP boundary:
//
//   C1 — D1: callback Set-Cookie auth_token (HttpOnly) + session=1 (JS-readable)
//        D2: callback body STILL carries access_token (frontend/ back-compat)
//        D3: per-request credential read priority HEADER > COOKIE, applied at
//            all four sites (catch-all /api/*, /ui-state/*, /worker/*, refresh);
//            a present header is terminal (an invalid header is NOT rescued by a
//            valid cookie); cookie-read VERIFIES (presence is not trust)
//   C2 — D4: GET /api/auth/me (cookie-or-header) → {userId, orgId, email}; 401
//            when neither; D5: logout clears BOTH cookies and still honours the
//            Bearer header path (PAT/headless).

interface ParsedSetCookie {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: string;
  path?: string;
  maxAge?: string;
}

function parseSetCookie(raw: string): ParsedSetCookie {
  const parts = raw
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const [first, ...rest] = parts;
  const eq = first.indexOf("=");
  const attrs: Record<string, string | true> = {};
  for (const seg of rest) {
    const i = seg.indexOf("=");
    if (i === -1) attrs[seg.toLowerCase()] = true;
    else attrs[seg.slice(0, i).toLowerCase()] = seg.slice(i + 1);
  }
  return {
    name: first.slice(0, eq),
    value: first.slice(eq + 1),
    httpOnly: attrs.httponly === true,
    secure: attrs.secure === true,
    sameSite: typeof attrs.samesite === "string" ? attrs.samesite : undefined,
    path: typeof attrs.path === "string" ? attrs.path : undefined,
    maxAge: typeof attrs["max-age"] === "string" ? attrs["max-age"] : undefined,
  };
}

/** The first parsed `Set-Cookie` header for `name`, emitted as its own header. */
function setCookie(res: Response, name: string): ParsedSetCookie | undefined {
  for (const raw of res.headers.getSetCookie()) {
    const parsed = parseSetCookie(raw);
    if (parsed.name === name) return parsed;
  }
  return undefined;
}

async function devSignIn(): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const res = await makeRequest("/api/auth/callback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: "dev-auth-code" }),
  });
  const body = (await res.json()) as { access_token: string; expires_in: number };
  return { accessToken: body.access_token, expiresIn: body.expires_in };
}

describe("ui-cookie-session: callback Set-Cookie + body token (C1, D1/D2)", () => {
  const originalAuthMode = process.env.AUTH_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    process.env.AUTH_MODE = "dev";
  });

  afterEach(() => {
    resetSessionStore();
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
  });

  it("sets the HttpOnly auth_token + JS-readable session cookies and keeps access_token in the body", async () => {
    const res = await makeRequest("/api/auth/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "dev-auth-code" }),
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { access_token: string; expires_in: number };
    // D2: the legacy body token survives (frontend/ still reads it).
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.length).toBeGreaterThan(0);
    expect(typeof body.expires_in).toBe("number");

    // D1: the credential cookie — HttpOnly, SameSite=Lax, Path=/, Max-Age==expiry,
    // and (dev/HTTP) NOT Secure. Host-only: the serialiser never emits Domain.
    const auth = setCookie(res, COOKIE_AUTH_TOKEN);
    expect(auth).toBeDefined();
    expect(auth!.value).toBe(body.access_token);
    expect(auth!.httpOnly).toBe(true);
    expect(auth!.secure).toBe(false);
    expect((auth!.sameSite ?? "").toLowerCase()).toBe("lax");
    expect(auth!.path).toBe("/");
    expect(auth!.maxAge).toBe(String(body.expires_in));

    // D1: the JS-readable sign-in flag — NOT HttpOnly, carries no secret.
    const flag = setCookie(res, COOKIE_SESSION_FLAG);
    expect(flag).toBeDefined();
    expect(flag!.httpOnly).toBe(false);
    expect(flag!.value).toBe("1");
    expect(flag!.value).not.toBe(body.access_token);
    expect((flag!.sameSite ?? "").toLowerCase()).toBe("lax");
    expect(flag!.path).toBe("/");
  });
});

describe("ui-cookie-session: header>cookie credential read at all four sites (C1, D3)", () => {
  const originalAuthMode = process.env.AUTH_MODE;
  const originalWorkosClient = process.env.WORKOS_CLIENT_ID;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    resetM2m();
    process.env.AUTH_MODE = "dev";
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    resetSessionStore();
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
    if (originalWorkosClient === undefined) delete process.env.WORKOS_CLIENT_ID;
    else process.env.WORKOS_CLIENT_ID = originalWorkosClient;
  });

  it("catch-all /api/*: a cookie-only request authorizes and injects the cookie token's identity", async () => {
    const { token } = await mintUserToken({
      sub: "user-cookie",
      email: "cookie@example.com",
      name: "Cookie",
      org_id: "org-cookie",
      sid: "sid-cookie",
    });

    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Cookie: `${COOKIE_AUTH_TOKEN}=${token}` },
      }),
    );
    expect(res.status).toBe(200);

    const [, init] = mockFetch.mock.calls.at(-1) as [unknown, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("X-User-Id")).toBe("user-cookie");
    expect(headers.get("X-Org-Id")).toBe("org-cookie");
    expect(headers.get("X-User-Email")).toBe("cookie@example.com");
  });

  it("catch-all /api/*: a valid header wins over an invalid cookie", async () => {
    const { token } = await mintUserToken({
      sub: "user-hdr",
      email: "hdr@example.com",
      name: "Hdr",
      org_id: "org-hdr",
      sid: "sid-hdr",
    });

    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: {
          Authorization: `Bearer ${token}`,
          Cookie: `${COOKIE_AUTH_TOKEN}=not-a-real-jwt.invalid.cookie`,
        },
      }),
    );
    expect(res.status).toBe(200);
    const [, init] = mockFetch.mock.calls.at(-1) as [unknown, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("X-User-Id")).toBe("user-hdr");
  });

  it("catch-all /api/*: an invalid header is NOT rescued by a valid cookie (present header is terminal)", async () => {
    const { token } = await mintUserToken({
      sub: "user-valid-cookie",
      email: "vc@example.com",
      name: "VC",
      org_id: "org-vc",
      sid: "sid-vc",
    });

    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: {
          Authorization: "Bearer garbage.invalid.header-jwt",
          Cookie: `${COOKIE_AUTH_TOKEN}=${token}`,
        },
      }),
    );
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("catch-all /api/*: an unverifiable cookie with no header is refused (cookie-read verifies)", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Cookie: `${COOKIE_AUTH_TOKEN}=garbage.not-a-jwt.value` },
      }),
    );
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("/ui-state/* (prod branch): falls back to the cookie and injects identity", async () => {
    process.env.AUTH_MODE = "production";
    process.env.WORKOS_CLIENT_ID = "test-workos-client";
    const { token } = await mintUserToken({
      sub: "u-uis",
      email: "uis@example.com",
      name: "Uis",
      org_id: "o-uis",
      sid: "sid-uis",
    });

    const res = await app.fetch(
      new Request("http://localhost/ui-state/state", {
        headers: { Cookie: `${COOKIE_AUTH_TOKEN}=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const [, init] = mockFetch.mock.calls.at(-1) as [unknown, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("X-User-Id")).toBe("u-uis");
    expect(headers.get("X-Org-Id")).toBe("o-uis");
  });

  it("/ui-state/* (prod branch): an unverifiable cookie with no header is refused", async () => {
    process.env.AUTH_MODE = "production";
    process.env.WORKOS_CLIENT_ID = "test-workos-client";

    const res = await app.fetch(
      new Request("http://localhost/ui-state/state", {
        headers: { Cookie: `${COOKIE_AUTH_TOKEN}=garbage.not-a-jwt` },
      }),
    );
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("/worker/* (prod branch): falls back to the cookie and injects identity", async () => {
    process.env.AUTH_MODE = "production";
    process.env.WORKOS_CLIENT_ID = "test-workos-client";
    const { token } = await mintUserToken({
      sub: "u-wrk",
      email: "wrk@example.com",
      name: "Wrk",
      org_id: "o-wrk",
      sid: "sid-wrk",
    });

    const res = await app.fetch(
      new Request("http://localhost/worker/chat", {
        headers: { Cookie: `${COOKIE_AUTH_TOKEN}=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const [, init] = mockFetch.mock.calls.at(-1) as [unknown, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("X-User-Id")).toBe("u-wrk");
  });

  it("/api/auth/refresh: a cookie-only client can refresh (UC-5)", async () => {
    const sid = "sid-refresh-cookie";
    const claims = {
      sub: "dev-user-001",
      email: "dev@localhost",
      name: "Dev User",
      org_id: "dev-org-001",
    };
    const { token } = await mintUserToken({ ...claims, sid });
    setSession(sid, {
      workos_refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user_claims: claims,
    });

    const res = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Cookie: `${COOKIE_AUTH_TOKEN}=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token?: string };
    expect(typeof body.access_token).toBe("string");
  });
});

describe("ui-cookie-session: GET /api/auth/me identity (C2, D4)", () => {
  const originalAuthMode = process.env.AUTH_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    resetM2m();
    process.env.AUTH_MODE = "dev";
  });

  afterEach(() => {
    resetSessionStore();
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
  });

  it("returns the identity carried by the auth_token cookie", async () => {
    const { token } = await mintUserToken({
      sub: "me-user",
      email: "me@example.com",
      name: "Me",
      org_id: "me-org",
      sid: "sid-me",
    });

    const res = await app.fetch(
      new Request("http://localhost/api/auth/me", {
        headers: { Cookie: `${COOKIE_AUTH_TOKEN}=${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "me-user",
      orgId: "me-org",
      email: "me@example.com",
    });
  });

  it("returns the identity carried by an Authorization header", async () => {
    const { token } = await mintUserToken({
      sub: "me-hdr",
      email: "mehdr@example.com",
      name: "MeHdr",
      org_id: "me-hdr-org",
      sid: "sid-me-hdr",
    });

    const res = await app.fetch(
      new Request("http://localhost/api/auth/me", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: "me-hdr",
      orgId: "me-hdr-org",
      email: "mehdr@example.com",
    });
  });

  it("returns 401 when neither a cookie nor a header is present", async () => {
    const res = await app.fetch(new Request("http://localhost/api/auth/me"));
    expect(res.status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("ui-cookie-session: POST /api/auth/logout teardown (C2, D5)", () => {
  const originalAuthMode = process.env.AUTH_MODE;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    resetM2m();
    process.env.AUTH_MODE = "dev";
  });

  afterEach(() => {
    resetSessionStore();
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
  });

  it("clears both cookies when carried by the session cookie", async () => {
    const { accessToken } = await devSignIn();

    const res = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Cookie: `${COOKIE_AUTH_TOKEN}=${accessToken}` },
      }),
    );
    expect([200, 204]).toContain(res.status);

    const auth = setCookie(res, COOKIE_AUTH_TOKEN);
    expect(auth).toBeDefined();
    expect(auth!.value).toBe("");
    expect(auth!.maxAge).toBe("0");
    expect(auth!.path).toBe("/");

    const flag = setCookie(res, COOKIE_SESSION_FLAG);
    expect(flag).toBeDefined();
    expect(flag!.value).toBe("");
    expect(flag!.maxAge).toBe("0");
    expect(flag!.path).toBe("/");
  });

  it("via a Bearer header still deletes the server session and clears the cookies", async () => {
    const { accessToken } = await devSignIn();
    const sid = decodeJwt(accessToken).sid as string;
    expect(getSession(sid)).not.toBeNull();

    const res = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    expect([200, 204]).toContain(res.status);

    // The PAT/headless path is preserved: the server session is gone.
    expect(getSession(sid)).toBeNull();
    // ...and the cookie teardown still rides along.
    expect(setCookie(res, COOKIE_AUTH_TOKEN)?.maxAge).toBe("0");
    expect(setCookie(res, COOKIE_SESSION_FLAG)?.maxAge).toBe("0");
  });
});

describe("mode discovery: GET /api/auth/config (ADR-050 §d)", () => {
  const originalAuthMode = process.env.AUTH_MODE;

  afterEach(() => {
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
  });

  it("returns 200 {mode:'dev'} with Cache-Control max-age when AUTH_MODE=dev", async () => {
    process.env.AUTH_MODE = "dev";
    const res = await makeRequest("/api/auth/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "dev" });
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
  });

  it("returns 200 {mode:'workos'} when AUTH_MODE=workos", async () => {
    process.env.AUTH_MODE = "workos";
    const res = await makeRequest("/api/auth/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ mode: "workos" });
  });

  it("requires no credential — a bare request returns 200, not 401", async () => {
    process.env.AUTH_MODE = "dev";
    const res = await makeRequest("/api/auth/config");
    expect(res.status).toBe(200);
    expect(res.status).not.toBe(401);
  });

  it("is side-effect-free — two consecutive calls return identical bodies and mint no login state cookie", async () => {
    process.env.AUTH_MODE = "dev";
    const first = await makeRequest("/api/auth/config");
    const second = await makeRequest("/api/auth/config");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toEqual(await second.json());
    // §d: config mints no CSRF login state — it sets no Set-Cookie.
    expect(first.headers.getSetCookie()).toEqual([]);
    expect(second.headers.getSetCookie()).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// CDO-S5 — WorkOS org-create interception (ADR-048 §1/§3/§5 + ADR-050 §b/§c)
// ----------------------------------------------------------------------------
//
// In AUTH_MODE=workos the proxy intercepts POST /api/orgs: pre-check name
// availability against the backend, provision the WorkOS org + membership, then
// forward to the backend carrying X-Provisioned-Org-Id. The post-response
// applyOrgCreateReissue (CDO-S4) still fires on the relayed 201. Every other
// proxied request — and every request in dev mode — is straight-through.
describe("CDO-S5: WorkOS org-create interception (workos mode)", () => {
  const originalAuthMode = process.env.AUTH_MODE;
  const originalWorkos = {
    base: process.env.WORKOS_BASE,
    key: process.env.WORKOS_API_KEY,
    client: process.env.WORKOS_CLIENT_ID,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionStore();
    resetM2m();
    process.env.AUTH_MODE = "workos";
    process.env.WORKOS_BASE = "https://workos.test";
    process.env.WORKOS_API_KEY = "wos-api-key";
    process.env.WORKOS_CLIENT_ID = "test-workos-client";
  });

  afterEach(() => {
    resetSessionStore();
    if (originalAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = originalAuthMode;
    if (originalWorkos.base === undefined) delete process.env.WORKOS_BASE;
    else process.env.WORKOS_BASE = originalWorkos.base;
    if (originalWorkos.key === undefined) delete process.env.WORKOS_API_KEY;
    else process.env.WORKOS_API_KEY = originalWorkos.key;
    if (originalWorkos.client === undefined) delete process.env.WORKOS_CLIENT_ID;
    else process.env.WORKOS_CLIENT_ID = originalWorkos.client;
  });

  /**
   * Route the stubbed global fetch by URL: backend availability, WorkOS org
   * create, WorkOS membership, and the backend forward each get their own
   * canned response. Records every call so the test can assert what was sent.
   */
  function routeFetch(opts: {
    availabilityStatus?: number;
    workosOrgId?: string;
    backendCreateStatus?: number;
  } = {}) {
    const {
      availabilityStatus = 200,
      workosOrgId = "wos-org-created",
      backendCreateStatus = 201,
    } = opts;
    const calls: { url: string; init: RequestInit }[] = [];
    mockFetch.mockImplementation(async (url: string, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.includes("/api/orgs/availability")) {
        return new Response(
          JSON.stringify({ available: availabilityStatus !== 409 }),
          { status: availabilityStatus, headers: { "content-type": "application/json" } },
        );
      }
      if (u.endsWith("/organizations")) {
        return new Response(JSON.stringify({ id: workosOrgId, name: "Acme" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("/organization_memberships")) {
        return new Response(JSON.stringify({ id: "om_1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      // The backend forward (POST /api/orgs).
      return new Response(JSON.stringify({ id: workosOrgId, name: "Acme" }), {
        status: backendCreateStatus,
        headers: { "content-type": "application/json" },
      });
    });
    return calls;
  }

  async function userToken(orgId = "") {
    const { token } = await mintUserToken({
      sub: "wos-user-1",
      email: "u@example.com",
      name: "U",
      org_id: orgId,
      sid: "sid-1",
    });
    return token;
  }

  function postOrgs(token: string, name = "Acme") {
    return app.fetch(
      new Request("http://localhost/api/orgs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      }),
    );
  }

  it("provisions the WorkOS org and forwards to the backend carrying X-Provisioned-Org-Id", async () => {
    const calls = routeFetch({ workosOrgId: "wos-org-abc" });
    const token = await userToken();

    const res = await postOrgs(token);
    expect(res.status).toBe(201);

    // The WorkOS org create happened.
    const workosCreate = calls.find((c) => c.url.endsWith("/organizations"));
    expect(workosCreate).toBeDefined();

    // The backend forward carried the freshly-created WorkOS org id.
    const forward = calls.find(
      (c) => c.url.includes("/api/orgs") && !c.url.includes("availability"),
    );
    expect(forward).toBeDefined();
    const fwdHeaders = forward!.init.headers as Headers;
    expect(fwdHeaders.get("X-Provisioned-Org-Id")).toBe("wos-org-abc");
  });

  it("a 409 pre-check synthesizes a 409 and makes ZERO WorkOS calls (no orphaned IdP org)", async () => {
    const calls = routeFetch({ availabilityStatus: 409 });
    const token = await userToken();

    const res = await postOrgs(token);
    expect(res.status).toBe(409);

    // No WorkOS egress whatsoever on the taken-name path.
    expect(calls.some((c) => c.url.endsWith("/organizations"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/organization_memberships"))).toBe(
      false,
    );
    // And no backend forward either — only the availability pre-check ran.
    expect(
      calls.some(
        (c) => c.url.includes("/api/orgs") && !c.url.includes("availability"),
      ),
    ).toBe(false);
  });

  it("applyOrgCreateReissue still fires on the relayed 201 (X-New-Access-Token present)", async () => {
    routeFetch({ workosOrgId: "wos-org-reissue" });
    const token = await userToken();

    const res = await postOrgs(token);
    expect(res.status).toBe(201);

    const newToken = res.headers.get("X-New-Access-Token");
    expect(newToken).toBeTruthy();
    // The reissued token carries the provisioned org id as its org_id claim.
    expect(decodeJwt(newToken!).org_id).toBe("wos-org-reissue");
  });

  it("a client-supplied X-Provisioned-Org-Id is stripped before the backend forward", async () => {
    const calls = routeFetch({ workosOrgId: "wos-org-real" });
    const token = await userToken();

    const res = await app.fetch(
      new Request("http://localhost/api/orgs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Provisioned-Org-Id": "client-smuggled-org",
        },
        body: JSON.stringify({ name: "Acme" }),
      }),
    );
    expect(res.status).toBe(201);

    const forward = calls.find(
      (c) => c.url.includes("/api/orgs") && !c.url.includes("availability"),
    );
    const fwdHeaders = forward!.init.headers as Headers;
    // The smuggled value is gone; only the proxy's provisioned id survives.
    expect(fwdHeaders.get("X-Provisioned-Org-Id")).toBe("wos-org-real");
    expect(fwdHeaders.get("X-Provisioned-Org-Id")).not.toBe(
      "client-smuggled-org",
    );
  });

  it("strips a client-supplied X-Provisioned-Org-Id on a NON-org route too (every route, strip-then-inject)", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const token = await userToken("o-1");

    await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-Provisioned-Org-Id": "client-smuggled-org",
        },
      }),
    );

    const [, init] = mockFetch.mock.calls.at(-1) as [unknown, RequestInit];
    const headers = init.headers as Headers;
    expect(headers.get("X-Provisioned-Org-Id")).toBeNull();
  });

  it("dev mode is straight-through: POST /api/orgs makes a single backend call, no WorkOS egress", async () => {
    process.env.AUTH_MODE = "dev";
    const calls: { url: string }[] = [];
    mockFetch.mockImplementation(async (url: string) => {
      calls.push({ url: String(url) });
      return new Response(JSON.stringify({ id: "org-dev", name: "Acme" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const token = await userToken();

    const res = await postOrgs(token);
    expect(res.status).toBe(201);

    // No interception: no availability pre-check, no WorkOS calls — just the
    // single straight-through backend proxy hop.
    expect(calls.some((c) => c.url.includes("availability"))).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/organizations"))).toBe(false);
    expect(calls.length).toBe(1);
  });
});
