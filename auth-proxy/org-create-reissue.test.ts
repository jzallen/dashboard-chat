/**
 * Integration tests — org-create response-header reissue (Stage 2)
 *
 * Source under test: full Hono app behavior for `POST /api/orgs` → auth-proxy
 * injects `X-New-Access-Token` (+ `X-New-Token-Expires-In`) on the response.
 * Real Hono app + real keypair (via `_resetForTests`) + a mocked upstream
 * backend (the `fetch` the proxy uses). Companion unit suite for the decision
 * hook: `auth-proxy/lib/post-response-reissue.test.ts`.
 *
 * **Rows #8-#10 are the load-bearing security tests (R7, HIGH).** A compromised
 * backend must NOT be able to smuggle `X-New-Access-Token` through auth-proxy —
 * the symmetric outbound strip (mirror of the inbound identity-header strip)
 * plus these tests are the architectural enforcement.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { decodeJwt } from "jose";

import { app } from "./app.ts";
import { verifyToken } from "./lib/auth.ts";
import { _resetForTests as resetM2m } from "./lib/m2m.ts";
import { _resetForTests as resetSessionStore } from "./lib/session-store.ts";
import { getUserTokenKid, isUserToken, mintUserToken } from "./lib/user-token.ts";

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

/** Configure the mocked upstream backend for the next proxied call. */
function upstreamResponds(opts: {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const headers = new Headers({ "content-type": "application/json", ...opts.headers });
  mockFetch.mockResolvedValue(
    new Response(opts.body === undefined ? null : JSON.stringify(opts.body), {
      status: opts.status,
      headers,
    }),
  );
}

/** Mint a real dev user token (callback flow) and return token + claims. */
async function issueDevToken(): Promise<{ token: string; claims: ReturnType<typeof decodeJwt> }> {
  const res = await app.fetch(
    new Request("http://localhost/api/auth/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "dev-auth-code" }),
    }),
  );
  const { access_token } = (await res.json()) as { access_token: string };
  return { token: access_token, claims: decodeJwt(access_token) };
}

/** POST /api/orgs through the proxy with a Bearer token. */
function postOrgs(token: string | null, body: unknown = { name: "Acme" }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return app.fetch(
    new Request("http://localhost/api/orgs", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  resetEnv();
  resetM2m();
  resetSessionStore();
  vi.clearAllMocks();
  process.env.AUTH_MODE = "dev";
  // The callback mint is local (no fetch); the only proxied fetch in these
  // tests is the POST /api/orgs upstream call, configured per test.
  upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });
});

afterEach(() => {
  resetEnv();
  resetM2m();
  resetSessionStore();
});

describe("org-create reissue — happy path", () => {
  it("sets X-New-Access-Token + X-New-Token-Expires-In on a 201", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });

    const res = await postOrgs(token);
    expect(res.status).toBe(201);

    const newToken = res.headers.get("X-New-Access-Token");
    const expiresIn = res.headers.get("X-New-Token-Expires-In");
    expect(newToken).toBeTruthy();
    expect(Number(expiresIn)).toBeGreaterThan(0);
  });

  it("the new token is auth-proxy-minted (kid) and verifies against the keypair", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });

    const res = await postOrgs(token);
    const newToken = res.headers.get("X-New-Access-Token")!;

    expect(isUserToken(newToken)).toBe(true);
    expect(decodeJwt(newToken)).toBeTruthy();
    const identity = await verifyToken(newToken);
    expect(identity.userId).toBe("dev-user-001");
    // Sanity: kid matches the user-token kid the issuer uses.
    expect(getUserTokenKid()).toBe("auth-proxy:user:1");
  });

  it("the new token's org_id matches the just-created org", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "org-fresh-123", name: "Acme" } });

    const res = await postOrgs(token);
    const newToken = res.headers.get("X-New-Access-Token")!;
    expect(decodeJwt(newToken).org_id).toBe("org-fresh-123");
  });

  it("preserves sub/email/sid; only org_id differs", async () => {
    const { token, claims } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });

    const res = await postOrgs(token);
    const next = decodeJwt(res.headers.get("X-New-Access-Token")!);

    expect(next.sub).toBe(claims.sub);
    expect(next.email).toBe(claims.email);
    expect(next.sid).toBe(claims.sid);
    expect(next.org_id).toBe("org-new");
    expect(next.org_id).not.toBe(claims.org_id);
  });

  it("reads the org id from a JSON:API body shape", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({
      status: 201,
      body: { data: { id: "org-jsonapi", attributes: { name: "Acme" } } },
    });

    const res = await postOrgs(token);
    const newToken = res.headers.get("X-New-Access-Token")!;
    expect(decodeJwt(newToken).org_id).toBe("org-jsonapi");
  });
});

describe("org-create reissue — does not fire", () => {
  it("POST /api/projects 201 gets no reissue header", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "proj-1" } });

    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: "P" }),
      }),
    );
    expect(res.headers.get("X-New-Access-Token")).toBeNull();
  });

  it("POST /api/orgs 400 gets no reissue header (status passed through)", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 400, body: { error: "bad_request" } });

    const res = await postOrgs(token, { name: "" });
    expect(res.status).toBe(400);
    expect(res.headers.get("X-New-Access-Token")).toBeNull();
  });

  it("POST /api/orgs 409 (name taken) gets no reissue header", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 409, body: { error: "name_taken" } });

    const res = await postOrgs(token);
    expect(res.status).toBe(409);
    expect(res.headers.get("X-New-Access-Token")).toBeNull();
  });

  it("unauthenticated POST /api/orgs fails 401 and never reaches the hook", async () => {
    const callsBefore = mockFetch.mock.calls.length;
    const res = await postOrgs(null);
    expect(res.status).toBe(401);
    expect(res.headers.get("X-New-Access-Token")).toBeNull();
    // Auth layer rejects before any upstream proxy call.
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
  });
});

describe("org-create reissue — R7: backend cannot smuggle the header", () => {
  it("strips a backend-supplied X-New-Access-Token on a 200 POST /api/projects", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({
      status: 200,
      body: { ok: true },
      headers: { "X-New-Access-Token": "malicious-jwt" },
    });

    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: "P" }),
      }),
    );
    expect(res.headers.get("X-New-Access-Token")).toBeNull();
  });

  it("strips a smuggled header on a 201 from a non-org path (hook does not fire)", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({
      status: 201,
      body: { id: "proj-1" },
      headers: { "X-New-Access-Token": "malicious-jwt" },
    });

    const res = await app.fetch(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: "P" }),
      }),
    );
    expect(res.headers.get("X-New-Access-Token")).toBeNull();
  });

  it("on POST /api/orgs 201 with a smuggled header, only auth-proxy's own mint survives", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({
      status: 201,
      body: { id: "org-new", name: "Acme" },
      headers: { "X-New-Access-Token": "malicious-jwt" },
    });

    const res = await postOrgs(token);
    const surviving = res.headers.get("X-New-Access-Token");
    expect(surviving).toBeTruthy();
    expect(surviving).not.toBe("malicious-jwt");
    // The surviving value is auth-proxy's own mint: it verifies against the keypair.
    expect(isUserToken(surviving!)).toBe(true);
    const identity = await verifyToken(surviving!);
    expect(identity.userId).toBe("dev-user-001");
    expect(decodeJwt(surviving!).org_id).toBe("org-new");
  });
});

/** Parsed Set-Cookie shape (ported from app.test.ts ~613-654). */
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

/** The first parsed `Set-Cookie` header for `name`. */
function setCookie(res: Response, name: string): ParsedSetCookie | undefined {
  for (const raw of res.headers.getSetCookie()) {
    const parsed = parseSetCookie(raw);
    if (parsed.name === name) return parsed;
  }
  return undefined;
}

// ui-cookie-session D8 un-park (ADR-050 §a): the org-create reissue rides
// Set-Cookie too — dual emission. The same fresh token that lands in
// X-New-Access-Token is ALSO written as the HttpOnly auth_token cookie, plus a
// JS-readable session=1 flag, as TWO distinct never-collapsed headers (UC-6).
// Mode-AGNOSTIC: emission is gated only by the existing path/method/status +
// isUserToken guards; ONLY the Secure attribute is dev-gated.
describe("org-create reissue — Set-Cookie dual emission (ADR-050 §a / D8)", () => {
  it("(a) emits an auth_token cookie (HttpOnly, Lax, Path=/, Max-Age=expiry) whose value == X-New-Access-Token", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });

    const res = await postOrgs(token);
    expect(res.status).toBe(201);

    const newToken = res.headers.get("X-New-Access-Token")!;
    const expiresIn = res.headers.get("X-New-Token-Expires-In")!;

    const cookie = setCookie(res, "auth_token");
    expect(cookie).toBeDefined();
    expect(cookie!.httpOnly).toBe(true);
    expect(cookie!.sameSite).toBe("Lax");
    expect(cookie!.path).toBe("/");
    expect(cookie!.maxAge).toBe(expiresIn);
    // Same minted token in both transports.
    expect(cookie!.value).toBe(newToken);
  });

  it("(b) emits a session=1 cookie that is NOT HttpOnly (JS-readable sign-in flag)", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });

    const res = await postOrgs(token);

    const flag = setCookie(res, "session");
    expect(flag).toBeDefined();
    expect(flag!.value).toBe("1");
    expect(flag!.httpOnly).toBe(false);
  });

  it("(c) emits the two cookies as SEPARATE headers, never one comma-joined value", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });

    const res = await postOrgs(token);

    const list = res.headers.getSetCookie();
    expect(list.length).toBeGreaterThanOrEqual(2);
    // No single header carries both cookie names comma-joined.
    for (const raw of list) {
      expect(raw.includes("auth_token=") && raw.includes("session=")).toBe(false);
    }
  });

  it("(d) STILL emits X-New-Access-Token AND X-New-Token-Expires-In (dual emission, not replacement)", async () => {
    const { token } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });

    const res = await postOrgs(token);

    expect(res.headers.get("X-New-Access-Token")).toBeTruthy();
    expect(Number(res.headers.get("X-New-Token-Expires-In"))).toBeGreaterThan(0);
  });

  it("(e) dev mode: the auth_token cookie has NO Secure attribute", async () => {
    process.env.AUTH_MODE = "dev";
    const { token } = await issueDevToken();
    upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });

    const res = await postOrgs(token);

    const cookie = setCookie(res, "auth_token");
    expect(cookie).toBeDefined();
    expect(cookie!.secure).toBe(false);
  });

  it("(f) workos mode: the auth_token cookie HAS Secure (mode-agnostic emission, dev-gated Secure only)", async () => {
    process.env.AUTH_MODE = "workos";
    // Mint a user token directly to avoid the dev callback path under workos.
    const { token } = await mintUserToken({
      sub: "u-workos",
      email: "w@x.example",
      name: "W",
      org_id: "",
      sid: "sid-workos",
    });
    upstreamResponds({ status: 201, body: { id: "org-new", name: "Acme" } });

    const res = await postOrgs(token);
    expect(res.status).toBe(201);

    const cookie = setCookie(res, "auth_token");
    expect(cookie).toBeDefined();
    expect(cookie!.secure).toBe(true);
  });

  it("(g) does NOT emit an auth_token cookie when the reissue does not fire", async () => {
    // POST /api/projects 201 — wrong path
    {
      const { token } = await issueDevToken();
      upstreamResponds({ status: 201, body: { id: "proj-1" } });
      const res = await app.fetch(
        new Request("http://localhost/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ name: "P" }),
        }),
      );
      expect(setCookie(res, "auth_token")).toBeUndefined();
    }
    // POST /api/orgs 400 — wrong status
    {
      const { token } = await issueDevToken();
      upstreamResponds({ status: 400, body: { error: "bad_request" } });
      const res = await postOrgs(token, { name: "" });
      expect(res.status).toBe(400);
      expect(setCookie(res, "auth_token")).toBeUndefined();
    }
    // POST /api/orgs 409 — wrong status
    {
      const { token } = await issueDevToken();
      upstreamResponds({ status: 409, body: { error: "name_taken" } });
      const res = await postOrgs(token);
      expect(res.status).toBe(409);
      expect(setCookie(res, "auth_token")).toBeUndefined();
    }
    // Unauthenticated POST /api/orgs 401 — never reaches the hook
    {
      const res = await postOrgs(null);
      expect(res.status).toBe(401);
      expect(setCookie(res, "auth_token")).toBeUndefined();
    }
  });
});

describe("org-create reissue — concurrency", () => {
  it("does not cross-contaminate tokens across concurrent callers", async () => {
    // Two distinct user identities (minted directly so sub differs — dev mode
    // would otherwise collapse both to dev-user-001).
    const a = await mintUserToken({
      sub: "u-A",
      email: "a@x.example",
      name: "A",
      org_id: "",
      sid: "sid-A",
    });
    const b = await mintUserToken({
      sub: "u-B",
      email: "b@x.example",
      name: "B",
      org_id: "",
      sid: "sid-B",
    });
    // Fresh Response per call: two concurrent proxied calls must not share one
    // upstream body stream (a single `mockResolvedValue` instance would be
    // consumed twice — a test artifact; in production each fetch is distinct).
    mockFetch.mockImplementation(
      async () =>
        new Response(JSON.stringify({ id: "org-new", name: "Acme" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );

    const [resA, resB] = await Promise.all([postOrgs(a.token), postOrgs(b.token)]);

    const tokA = resA.headers.get("X-New-Access-Token")!;
    const tokB = resB.headers.get("X-New-Access-Token")!;
    expect(decodeJwt(tokA).sub).toBe("u-A");
    expect(decodeJwt(tokB).sub).toBe("u-B");
  });
});
