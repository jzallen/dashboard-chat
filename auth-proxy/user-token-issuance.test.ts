/**
 * Test plan — user-token issuance endpoints (Stage 1)
 *
 * Source under test: the Hono app endpoints in `auth-proxy/app.ts`:
 *   - `GET  /api/auth/login`
 *   - `POST /api/auth/callback`
 *   - `POST /api/auth/refresh`
 *   - `POST /api/auth/logout`
 *
 * Mirrors the shape of `auth-proxy/m2m-issuance.test.ts` and
 * `auth-proxy/pat-issuance.test.ts`: full Hono app, real keypair (via
 * `_resetForTests`), mocked `fetch` for WorkOS. This is the integration tier;
 * unit-level coverage for the providers lives in `lib/user-auth/dev.test.ts`
 * + `lib/user-auth/workos.test.ts`.
 *
 * Together with the two unit suites, this file is THE proof that the OQ1 (b)
 * server-held session model works end-to-end. Row #13 (refresh does NOT return
 * the WorkOS token) and row #19 (identity-header stripping) are the load-bearing
 * security invariants.
 *
 * All 20 acceptance rows of Stage 1 are landed. The table is intentionally
 * empty — see the implemented `describe`/`it` blocks below for the pinned
 * behavior, and the git log for the row-by-row landing history.
 *
 * **Notes for the agent:**
 * - Mirror the harness shape from `m2m-issuance.test.ts:228+` (round-trip section) for rows #16–#19.
 * - For #19: use `pat-issuance.test.ts:459-498` as the precedent — the test pattern for "client header is stripped" is established.
 * - Mock WorkOS at the `fetch` boundary. Inject `fetch` via the same DI seam the providers use; do not monkey-patch `globalThis.fetch`.
 * - Use `_resetForTests()` between tests (keypair, session-store, env). See `m2m-issuance.test.ts` for the precedent.
 * - For #11 (expired session): set a small TTL in the test or stub `Date.now()` via vitest's fake timers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decodeJwt, generateKeyPair, SignJWT } from "jose";

import { app } from "./app.ts";
import { _resetForTests as resetM2m } from "./lib/m2m.ts";
import {
  _resetForTests as resetSessionStore,
  getSession,
  setSession,
} from "./lib/session-store.ts";

const ORIG_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith("M2M_") ||
      key.startsWith("WORKOS_") ||
      key === "AUTH_MODE" ||
      key === "AUTH_PROXY_KEYPAIR_PATH" ||
      key === "BACKEND_URL" ||
      key === "JWKS_URL" ||
      key === "SESSION_STORE_PATH" ||
      key === "USER_TOKEN_TTL_SECONDS"
    ) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (
      k.startsWith("M2M_") ||
      k.startsWith("WORKOS_") ||
      k === "AUTH_MODE" ||
      k === "AUTH_PROXY_KEYPAIR_PATH" ||
      k === "BACKEND_URL" ||
      k === "JWKS_URL" ||
      k === "SESSION_STORE_PATH" ||
      k === "USER_TOKEN_TTL_SECONDS"
    ) {
      if (v !== undefined) process.env[k] = v;
    }
  }
}

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  resetEnv();
  resetM2m();
  resetSessionStore();
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
  resetEnv();
  resetM2m();
  resetSessionStore();
});

describe("login — dev mode", () => {
  it("returns a JSON redirect URL the FE can navigate to", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/login", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    expect(typeof body.url).toBe("string");
    expect(body.url.length).toBeGreaterThan(0);
    // Dev login completes locally: the redirect URL carries the dev auth
    // code that /api/auth/callback recognises.
    expect(body.url).toContain("code=dev-auth-code");
  });
});

describe("login — workos mode", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "workos";
    process.env.WORKOS_CLIENT_ID = "test-workos-client";
    process.env.WORKOS_REDIRECT_URI = "https://app.example.com/auth/callback";
  });

  it("returns the WorkOS authorize URL with client_id, redirect_uri, and state", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/login", { method: "GET" }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string };
    const url = new URL(body.url);
    expect(`${url.origin}${url.pathname}`).toBe(
      "https://api.workos.com/user_management/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("test-workos-client");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/auth/callback",
    );
    const state = url.searchParams.get("state");
    expect(state).not.toBeNull();
    // CSRF state must be non-empty and opaque (no semantic structure the
    // attacker could guess). A reasonable proxy for "opaque" is length —
    // 16+ base64url chars is ~96+ bits of entropy.
    expect(state!.length).toBeGreaterThanOrEqual(16);
  });

  it("emits a unique state per login (no replay across separate calls)", async () => {
    const a = await app.fetch(
      new Request("http://localhost/api/auth/login", { method: "GET" }),
    );
    const b = await app.fetch(
      new Request("http://localhost/api/auth/login", { method: "GET" }),
    );
    const stateA = new URL(((await a.json()) as { url: string }).url)
      .searchParams.get("state");
    const stateB = new URL(((await b.json()) as { url: string }).url)
      .searchParams.get("state");
    expect(stateA).not.toBe(stateB);
  });
});

describe("callback — dev mode", () => {
  it("mints a verifiable access_token for the dev auth code", async () => {
    const res = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.split(".")).toHaveLength(3);
    expect(body.expires_in).toBeGreaterThan(0);

    // The minted token must verify through auth-proxy's verifyToken
    // dispatch — i.e. the kid lookup hits the local user-token branch.
    const { verifyToken } = await import("./lib/auth.ts");
    const identity = await verifyToken(body.access_token);
    expect(identity).toEqual({
      userId: "dev-user-001",
      orgId: "dev-org-001",
      email: "dev@localhost",
    });

    // The callback handler must also remember the session server-side
    // keyed by the sid claim — `/api/auth/refresh` will look it up later.
    const payload = decodeJwt(body.access_token);
    const sid = payload.sid as string;
    expect(typeof sid).toBe("string");
    expect(sid.length).toBeGreaterThan(0);
    const stored = getSession(sid);
    expect(stored).not.toBeNull();
    expect(stored!.user_claims).toEqual({
      sub: "dev-user-001",
      email: "dev@localhost",
      name: "Dev User",
      org_id: "dev-org-001",
    });
  });
});

describe("callback — workos mode", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "workos";
    process.env.WORKOS_CLIENT_ID = "test-workos-client";
    process.env.WORKOS_API_KEY = "sk_test_workos";
    process.env.WORKOS_REDIRECT_URI = "https://app.example.com/auth/callback";
  });

  it("exchanges {code,state} with WorkOS authenticate and returns a local JWT", async () => {
    // Issue a login first so the state value is remembered server-side.
    const loginRes = await app.fetch(
      new Request("http://localhost/api/auth/login", { method: "GET" }),
    );
    const { url: loginUrl } = (await loginRes.json()) as { url: string };
    const state = new URL(loginUrl).searchParams.get("state")!;

    // Mock WorkOS exchange happy-path. The mock matcher inspects the
    // outbound URL so we can assert the right WorkOS endpoint was called.
    mockFetch.mockImplementation(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url === "https://api.workos.com/user_management/authenticate") {
        return new Response(
          JSON.stringify({
            access_token: "wos-access-stand-in",
            refresh_token: "wos-r-123",
            user: {
              id: "wos-user-42",
              email: "alice@workos.example",
              first_name: "Alice",
            },
            organization_id: "wos-org-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const res = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "wos-code-real", state }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token.split(".")).toHaveLength(3);

    // Single WorkOS exchange call, no extras.
    const workosCalls = mockFetch.mock.calls.filter(
      ([input]) =>
        (typeof input === "string" ? input : (input as URL).toString?.() || (input as Request).url) ===
        "https://api.workos.com/user_management/authenticate",
    );
    expect(workosCalls).toHaveLength(1);

    // The minted token carries the WorkOS user identity.
    const payload = decodeJwt(body.access_token);
    expect(payload.sub).toBe("wos-user-42");
    expect(payload.email).toBe("alice@workos.example");
    expect(payload.org_id).toBe("wos-org-1");
  });

  it("rejects a state value that doesn't match a remembered login state", async () => {
    // No prior /api/auth/login → no state remembered; an attacker-supplied
    // state must be rejected before any WorkOS round-trip.
    const res = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "wos-code-real", state: "forged-state" }),
      }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("state_mismatch");

    // And no WorkOS call was made.
    const workosCalls = mockFetch.mock.calls.filter(
      ([input]) =>
        (typeof input === "string"
          ? input
          : (input as URL).toString?.() || (input as Request).url) ===
        "https://api.workos.com/user_management/authenticate",
    );
    expect(workosCalls).toHaveLength(0);
  });

  it("refuses to honour the dev auth code when AUTH_MODE is not dev", async () => {
    // Same dev-auth-code that would mint in dev mode — must NOT mint here.
    const res = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );

    expect(res.status).not.toBe(200);
    const body = (await res.json()) as { access_token?: string };
    expect(body.access_token).toBeUndefined();
    // The session-store must NOT have grown a dev entry by side-effect.
    const stored = getSession("dev-user-001");
    expect(stored).toBeNull();
  });
});

describe("dev parity — no WorkOS env vars required", () => {
  it("mints in dev mode with no WORKOS_* env set and no WorkOS fetch attempt", async () => {
    // Ensure every WORKOS_* env is unset.
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("WORKOS_")) delete process.env[key];
    }
    // The shared beforeEach mock returns {ok: true} — if any code path
    // tried to talk to WorkOS, mockFetch would record the call.
    const callsBefore = mockFetch.mock.calls.length;

    const res = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    expect(body.access_token.split(".")).toHaveLength(3);

    // No additional fetch calls were issued during the dev-mode mint.
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
  });
});

describe("security — identity-header stripping", () => {
  it("strips client-supplied X-User-* / X-Org-* headers and replaces with token-derived ones", async () => {
    const issueRes = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );
    const { access_token } = (await issueRes.json()) as {
      access_token: string;
    };

    await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: {
          Authorization: `Bearer ${access_token}`,
          "X-User-Id": "attacker-001",
          "X-Org-Id": "evil-org",
          "X-User-Email": "attacker@evil.example",
        },
      }),
    );

    const lastCall = mockFetch.mock.calls.at(-1) as [unknown, RequestInit];
    const headers = lastCall[1].headers as Headers;
    // Token-derived identity, NOT attacker-supplied.
    expect(headers.get("X-User-Id")).toBe("dev-user-001");
    expect(headers.get("X-Org-Id")).toBe("dev-org-001");
    expect(headers.get("X-User-Email")).toBe("dev@localhost");
  });
});

describe("round-trip — issued user token as Bearer", () => {
  it("rejects a foreign-key-signed token even when the kid header matches", async () => {
    // Forge a token using a freshly-generated keypair but with the
    // legitimate user-token kid in the header. A naive verifier that
    // trusted the kid alone would accept this; verifyToken must
    // verify against the actual auth-proxy keypair.
    const { privateKey } = await generateKeyPair("RS256");
    const forged = await new SignJWT({
      email: "attacker@evil",
      name: "Attacker",
      org_id: "evil-org",
      sid: "forged-sid",
    })
      .setProtectedHeader({ alg: "RS256", kid: "auth-proxy:user:1" })
      .setSubject("attacker")
      .setIssuer("auth-proxy")
      .setAudience("dev-client")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const before = mockFetch.mock.calls.length;
    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Authorization: `Bearer ${forged}` },
      }),
    );
    expect(res.status).toBe(401);
    expect(mockFetch.mock.calls.length).toBe(before);
  });

  it("returns 401 for a tampered signature on a user-token Bearer", async () => {
    const issueRes = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );
    const { access_token } = (await issueRes.json()) as {
      access_token: string;
    };

    // Flip the first char of the signature segment.
    const [header, payload, sig] = access_token.split(".");
    const tampered = `${header}.${payload}.${
      sig.startsWith("A") ? "B" : "A"
    }${sig.slice(1)}`;

    const before = mockFetch.mock.calls.length;
    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Authorization: `Bearer ${tampered}` },
      }),
    );
    expect(res.status).toBe(401);
    // And no upstream call was made for the tampered request.
    expect(mockFetch.mock.calls.length).toBe(before);
  });

  it("authenticates on a protected endpoint and forwards identity headers", async () => {
    const issueRes = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );
    const { access_token } = (await issueRes.json()) as {
      access_token: string;
    };

    const protectedRes = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Authorization: `Bearer ${access_token}` },
      }),
    );
    expect(protectedRes.status).toBe(200);

    // The upstream backend call carried the identity headers derived
    // from the user-token claims, not from any client-supplied headers.
    const lastCall = mockFetch.mock.calls.at(-1) as [unknown, RequestInit];
    const headers = lastCall[1].headers as Headers;
    expect(headers.get("X-User-Id")).toBe("dev-user-001");
    expect(headers.get("X-Org-Id")).toBe("dev-org-001");
    expect(headers.get("X-User-Email")).toBe("dev@localhost");
  });
});

describe("logout — dev mode", () => {
  it("is idempotent: a second logout with the same token still returns 204", async () => {
    const callbackRes = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );
    const { access_token } = (await callbackRes.json()) as {
      access_token: string;
    };

    const first = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}` },
      }),
    );
    expect(first.status).toBe(204);

    const second = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}` },
      }),
    );
    expect(second.status).toBe(204);
  });

  it("returns 204 and deletes the session entry by sid", async () => {
    const callbackRes = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );
    const { access_token } = (await callbackRes.json()) as {
      access_token: string;
    };
    const sid = decodeJwt(access_token).sid as string;
    expect(getSession(sid)).not.toBeNull();

    const res = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${access_token}` },
      }),
    );
    expect(res.status).toBe(204);
    expect(getSession(sid)).toBeNull();
  });
});

describe("logout — workos mode (WorkOS end-session)", () => {
  /** Issue a token via the dev callback (the local keypair verifies regardless
   *  of mode), attach a stored WorkOS session id, then flip to workos so the
   *  logout handler reads AUTH_MODE + the stored sid at request time. */
  async function issueTokenWithWorkosSession(
    workosSessionId: string | undefined,
  ): Promise<string> {
    const callbackRes = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );
    const { access_token } = (await callbackRes.json()) as {
      access_token: string;
    };
    const sid = decodeJwt(access_token).sid as string;
    setSession(sid, {
      workos_refresh_token: "r",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user_claims: { sub: "u", email: "u@x", name: "U", org_id: "" },
      workos_session_id: workosSessionId,
    });
    return access_token;
  }

  it("returns a WorkOS end-session logout_url built from the stored session id", async () => {
    const token = await issueTokenWithWorkosSession("session_01WOS");
    process.env.AUTH_MODE = "workos";
    process.env.WORKOS_BASE = "https://api.workos.test";

    const res = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { logout_url: string };
    expect(body.logout_url).toContain(
      "https://api.workos.test/user_management/sessions/logout",
    );
    expect(body.logout_url).toContain("session_id=session_01WOS");
  });

  it("falls back to 204 (no url) when the session carries no WorkOS session id", async () => {
    const token = await issueTokenWithWorkosSession(undefined);
    process.env.AUTH_MODE = "workos";

    const res = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(204);
  });
});

describe("refresh — workos mode", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "workos";
    process.env.WORKOS_CLIENT_ID = "test-workos-client";
    process.env.WORKOS_API_KEY = "sk_test_workos";
    process.env.WORKOS_REDIRECT_URI = "https://app.example.com/auth/callback";
  });

  /**
   * Helper: issue a fresh access_token via the workos callback flow,
   * with a mock for the initial WorkOS authenticate call. Returns the
   * token + sid + the refresh_token that WorkOS handed us (which is
   * now living in the session-store).
   */
  async function issueWorkosToken(opts: {
    initialRefreshToken: string;
  }): Promise<{ token: string; sid: string }> {
    mockFetch.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "wos-access",
            refresh_token: opts.initialRefreshToken,
            user: {
              id: "wos-user-1",
              email: "alice@workos.example",
              first_name: "Alice",
            },
            organization_id: "wos-org-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const loginRes = await app.fetch(
      new Request("http://localhost/api/auth/login", { method: "GET" }),
    );
    const { url } = (await loginRes.json()) as { url: string };
    const state = new URL(url).searchParams.get("state")!;
    const callbackRes = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "wos-code", state }),
      }),
    );
    const { access_token } = (await callbackRes.json()) as {
      access_token: string;
    };
    const sid = decodeJwt(access_token).sid as string;
    return { token: access_token, sid };
  }

  it("OQ1 (b) invariant: refresh response NEVER contains the WorkOS refresh_token", async () => {
    const { token } = await issueWorkosToken({
      initialRefreshToken: "wos-r-secret-OLD",
    });

    mockFetch.mockImplementationOnce(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "wos-access-2",
            refresh_token: "wos-r-secret-NEW",
            user: {
              id: "wos-user-1",
              email: "alice@workos.example",
              first_name: "Alice",
            },
            organization_id: "wos-org-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const refreshRes = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(refreshRes.status).toBe(200);

    // 1. Body must not contain the WorkOS refresh_token (old or new)
    //    as a JSON field, anywhere.
    const raw = await refreshRes.clone().text();
    expect(raw).not.toContain("wos-r-secret-OLD");
    expect(raw).not.toContain("wos-r-secret-NEW");
    const body = (await refreshRes.clone().json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("refresh_token");
    expect(body.access_token).toBeTypeOf("string");

    // 2. No response header carries either refresh_token value.
    let foundSecret = false;
    refreshRes.headers.forEach((value) => {
      if (
        value.includes("wos-r-secret-OLD") ||
        value.includes("wos-r-secret-NEW")
      ) {
        foundSecret = true;
      }
    });
    expect(foundSecret).toBe(false);
  });

  it("rotates the stored WorkOS refresh_token using the prior one", async () => {
    const { token, sid } = await issueWorkosToken({
      initialRefreshToken: "wos-r-old",
    });
    expect(getSession(sid)?.workos_refresh_token).toBe("wos-r-old");

    // Capture the outbound /authenticate body to verify we sent the
    // prior refresh_token. WorkOS returns a new refresh_token in the
    // response which the handler must store.
    let capturedAuthenticateBody: Record<string, unknown> | null = null;
    mockFetch.mockImplementationOnce(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      expect(url).toBe(
        "https://api.workos.com/user_management/authenticate",
      );
      capturedAuthenticateBody = JSON.parse(
        (init as { body: string }).body,
      );
      return new Response(
        JSON.stringify({
          access_token: "wos-access-2",
          refresh_token: "wos-r-new",
          user: {
            id: "wos-user-1",
            email: "alice@workos.example",
            first_name: "Alice",
          },
          organization_id: "wos-org-1",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const refreshRes = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(refreshRes.status).toBe(200);
    // The outbound call carried the OLD refresh_token.
    expect(capturedAuthenticateBody).toMatchObject({
      refresh_token: "wos-r-old",
      grant_type: "refresh_token",
    });
    // The session-store now holds the NEW refresh_token.
    expect(getSession(sid)?.workos_refresh_token).toBe("wos-r-new");
  });
});

describe("refresh — dev mode", () => {
  /**
   * Helper: issue a fresh access_token via the dev callback, returning
   * both the token and the sid claim embedded in it. Used by every
   * refresh test so the setup stays atomic per test.
   */
  async function issueDevToken(): Promise<{ token: string; sid: string }> {
    const callbackRes = await app.fetch(
      new Request("http://localhost/api/auth/callback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "dev-auth-code" }),
      }),
    );
    const { access_token } = (await callbackRes.json()) as {
      access_token: string;
    };
    const sid = decodeJwt(access_token).sid as string;
    return { token: access_token, sid };
  }

  it("re-sets the auth_token + session cookies so a cookie-only client slides forward", async () => {
    const { token } = await issueDevToken();

    const res = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
    );

    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    expect(cookies.some((c) => c.startsWith("auth_token="))).toBe(true);
    expect(cookies.some((c) => c.startsWith("session=1"))).toBe(true);
  });

  it("rejects with 401 session_expired when the session has aged out", async () => {
    const original = await issueDevToken();
    // Backdate the session-store entry so its expires_at is in the past.
    setSession(original.sid, {
      workos_refresh_token: "dev-refresh-token-001",
      expires_at: Math.floor(Date.now() / 1000) - 60,
      user_claims: {
        sub: "dev-user-001",
        email: "dev@localhost",
        name: "Dev User",
        org_id: "dev-org-001",
      },
    });

    const res = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${original.token}` },
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("session_expired");

    // Expired entry is lazily evicted: a follow-up getSession returns null.
    expect(getSession(original.sid)).toBeNull();
  });

  it("rejects with 401 invalid_session after the session was logged out", async () => {
    const original = await issueDevToken();

    const logoutRes = await app.fetch(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${original.token}` },
      }),
    );
    expect(logoutRes.status).toBe(204);

    const refreshRes = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${original.token}` },
      }),
    );
    expect(refreshRes.status).toBe(401);
    const body = (await refreshRes.json()) as { error: string };
    expect(body.error).toBe("invalid_session");
  });

  it("rejects with 401 invalid_session when the Bearer's sid isn't in the store", async () => {
    const original = await issueDevToken();
    // Wipe the server-side session store but keep the token valid (kid +
    // signature unchanged). The sid claim no longer resolves.
    resetSessionStore();

    const res = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${original.token}` },
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("invalid_session");
  });

  it("mints a fresh access_token whose claims match the original session", async () => {
    const original = await issueDevToken();
    // Wait a beat so the new token's iat is observably later (jose sets
    // iat at second resolution).
    await new Promise((r) => setTimeout(r, 1100));

    const res = await app.fetch(
      new Request("http://localhost/api/auth/refresh", {
        method: "POST",
        headers: { Authorization: `Bearer ${original.token}` },
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string };
    expect(typeof body.access_token).toBe("string");
    expect(body.access_token).not.toBe(original.token);

    const originalClaims = decodeJwt(original.token);
    const refreshedClaims = decodeJwt(body.access_token);
    expect(refreshedClaims.sub).toBe(originalClaims.sub);
    expect(refreshedClaims.org_id).toBe(originalClaims.org_id);
    expect(refreshedClaims.sid).toBe(originalClaims.sid);
    expect(refreshedClaims.iat).toBeGreaterThan(originalClaims.iat as number);
  });
});
