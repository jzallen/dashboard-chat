/**
 * Integration tests for the user-issued PAT (Personal Access Token) flow.
 *
 * Lifecycle covered: issue → use → list → revoke → use-fails.
 * Issuer endpoint authenticates the caller via the existing JWT/JWKS path
 * (a real WorkOS or dev-backend user JWT — NOT a PAT, to prevent self-replication).
 * Issued tokens carry kid `auth-proxy:pat:1` and are validatable through the
 * same verifyToken dispatch the proxy uses for every other Bearer.
 *
 * Strategy: real `jose` end-to-end. We generate a stand-in "user JWKS"
 * keypair in the test, sign synthetic user JWTs with its private key,
 * and stub `fetch` to respond to the JWKS URL with the matching public
 * key. PAT signing/verification uses auth-proxy's own keypair (the
 * lazily generated one inside `lib/pat.ts`), unmocked.
 */

import { exportJWK, generateKeyPair, type KeyLike, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "./app.ts";
import { _resetForTests as resetM2m } from "./lib/m2m.ts";
import { _resetForTests as resetPat } from "./lib/pat.ts";

const ORIG_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith("M2M_") ||
      key.startsWith("PAT_") ||
      key === "AUTH_MODE" ||
      key === "BACKEND_URL" ||
      key === "JWKS_URL" ||
      key === "WORKOS_CLIENT_ID"
    ) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (
      k.startsWith("M2M_") ||
      k.startsWith("PAT_") ||
      k === "AUTH_MODE" ||
      k === "BACKEND_URL" ||
      k === "JWKS_URL" ||
      k === "WORKOS_CLIENT_ID"
    ) {
      if (v !== undefined) process.env[k] = v;
    }
  }
}

const USER_A = {
  sub: "user-aaa",
  org_id: "org-aaa",
  email: "alice@example.com",
};
const USER_B = {
  sub: "user-bbb",
  org_id: "org-bbb",
  email: "bob@example.com",
};

const DEV_ISSUER = "http://localhost:8000";
const DEV_AUDIENCE = "dev-client";
const JWKS_URL = `${DEV_ISSUER}/.well-known/jwks.json`;

let userPrivateKey: KeyLike | Uint8Array;
let userJwks: { keys: object[] };
let USER_A_TOKEN = "";
let USER_B_TOKEN = "";

async function signUserJwt(claims: {
  sub: string;
  org_id: string;
  email: string;
}): Promise<string> {
  return new SignJWT({ org_id: claims.org_id, email: claims.email })
    .setProtectedHeader({ alg: "RS256", kid: "test-user-key" })
    .setSubject(claims.sub)
    .setIssuer(DEV_ISSUER)
    .setAudience(DEV_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(userPrivateKey);
}

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  userPrivateKey = privateKey;
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-user-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  userJwks = { keys: [jwk] };

  USER_A_TOKEN = await signUserJwt(USER_A);
  USER_B_TOKEN = await signUserJwt(USER_B);
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  resetEnv();
  resetM2m();
  resetPat();
  vi.clearAllMocks();
  process.env.AUTH_MODE = "dev";
  process.env.M2M_ENABLED = "true";
  process.env.BACKEND_URL = DEV_ISSUER;
  process.env.JWKS_URL = JWKS_URL;
  // Default fetch handler: serve JWKS, otherwise return ok for proxied paths.
  mockFetch.mockImplementation(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : (input as URL).toString
      ? (input as URL).toString()
      : (input as Request).url;
    if (url === JWKS_URL || url.endsWith("/.well-known/jwks.json")) {
      return new Response(JSON.stringify(userJwks), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
});

afterEach(() => {
  resetEnv();
  resetM2m();
  resetPat();
});

interface PatIssueResponse {
  id: string;
  token: string;
  name: string;
  created_at: string;
  expires_at: string | null;
}

interface PatListItem {
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

async function issuePat(
  authToken: string | null,
  body: Record<string, unknown> = { name: "test-pat" },
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return app.fetch(
    new Request("http://localhost/api/auth/pats", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
}

async function listPats(authToken: string): Promise<Response> {
  return app.fetch(
    new Request("http://localhost/api/auth/pats", {
      headers: { Authorization: `Bearer ${authToken}` },
    }),
  );
}

async function revokePatReq(
  authToken: string,
  patId: string,
): Promise<Response> {
  return app.fetch(
    new Request(`http://localhost/api/auth/pats/${patId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authToken}` },
    }),
  );
}

async function useToken(token: string): Promise<Response> {
  return app.fetch(
    new Request("http://localhost/api/projects", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

/** Filter the proxied (non-JWKS) fetch calls. */
function proxiedCalls(): unknown[][] {
  return mockFetch.mock.calls.filter((call) => {
    const url = String(call[0]);
    return !url.endsWith("/.well-known/jwks.json");
  });
}

describe("PAT issuance — flag gate", () => {
  it("returns 404 when M2M_ENABLED is unset", async () => {
    delete process.env.M2M_ENABLED;
    const res = await issuePat(USER_A_TOKEN);
    expect(res.status).toBe(404);
  });
});

describe("PAT issuance — auth required", () => {
  it("returns 401 when no Authorization header is present", async () => {
    const res = await issuePat(null);
    expect(res.status).toBe(401);
  });

  it("returns 401 when the user JWT is invalid", async () => {
    const res = await issuePat("not.a.valid.token");
    expect(res.status).toBe(401);
  });

  it("rejects a PAT being used to issue another PAT (no replication)", async () => {
    // First mint a PAT as user A.
    const issueRes = await issuePat(USER_A_TOKEN, { name: "first" });
    expect(issueRes.status).toBe(201);
    const { token: patToken } = (await issueRes.json()) as PatIssueResponse;

    // Now try using that PAT to mint a second PAT — must be refused.
    const replicateRes = await issuePat(patToken, { name: "second" });
    expect(replicateRes.status).toBe(403);
  });
});

describe("PAT issuance — happy path", () => {
  it("returns 201 + a token + metadata bound to the caller's identity", async () => {
    const res = await issuePat(USER_A_TOKEN, { name: "my-cli" });
    expect(res.status).toBe(201);

    const body = (await res.json()) as PatIssueResponse;
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
    expect(typeof body.token).toBe("string");
    expect(body.token.split(".")).toHaveLength(3);
    expect(body.name).toBe("my-cli");
    expect(typeof body.created_at).toBe("string");
    // No expires_in supplied → expires_at is null (long-lived).
    expect(body.expires_at).toBeNull();
  });

  it("honors expires_in_seconds when provided", async () => {
    const res = await issuePat(USER_A_TOKEN, {
      name: "short-lived",
      expires_in_seconds: 60,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as PatIssueResponse;
    expect(body.expires_at).not.toBeNull();
    const exp = new Date(body.expires_at as string).getTime();
    const now = Date.now();
    expect(exp - now).toBeGreaterThan(30_000);
    expect(exp - now).toBeLessThan(120_000);
  });

  it("requires a non-empty name", async () => {
    const res = await issuePat(USER_A_TOKEN, { name: "" });
    expect(res.status).toBe(400);
  });
});

describe("PAT use — issued token validates through the proxy auth path", () => {
  it("forwards the caller's identity headers when a PAT is used as Bearer", async () => {
    const issueRes = await issuePat(USER_A_TOKEN);
    const { token } = (await issueRes.json()) as PatIssueResponse;

    const protectedRes = await useToken(token);
    expect(protectedRes.status).toBe(200);

    const calls = proxiedCalls();
    expect(calls).toHaveLength(1);
    const [, fetchOptions] = calls[0] as [unknown, RequestInit];
    const headers = fetchOptions.headers as Headers;
    expect(headers.get("X-User-Id")).toBe(USER_A.sub);
    expect(headers.get("X-Org-Id")).toBe(USER_A.org_id);
    expect(headers.get("X-User-Email")).toBe(USER_A.email);
  });
});

describe("PAT list — scoped to the owning user", () => {
  it("lists only the caller's PATs (not other users')", async () => {
    const a1 = (await (await issuePat(USER_A_TOKEN, { name: "a1" })).json()) as PatIssueResponse;
    const a2 = (await (await issuePat(USER_A_TOKEN, { name: "a2" })).json()) as PatIssueResponse;
    await issuePat(USER_B_TOKEN, { name: "b1" });

    const listRes = await listPats(USER_A_TOKEN);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as { pats: PatListItem[] };
    const ids = list.pats.map((p) => p.id).sort();
    expect(ids).toEqual([a1.id, a2.id].sort());
  });

  it("does not include the token secret in list responses", async () => {
    await issuePat(USER_A_TOKEN, { name: "secret-checker" });
    const listRes = await listPats(USER_A_TOKEN);
    const list = (await listRes.json()) as { pats: Record<string, unknown>[] };
    for (const item of list.pats) {
      expect(item).not.toHaveProperty("token");
      expect(item).not.toHaveProperty("access_token");
    }
  });
});

describe("PAT revoke — immediate", () => {
  it("returns 204 and the token stops working", async () => {
    const issueRes = await issuePat(USER_A_TOKEN, { name: "doomed" });
    const { id, token } = (await issueRes.json()) as PatIssueResponse;

    expect((await useToken(token)).status).toBe(200);

    const revokeRes = await revokePatReq(USER_A_TOKEN, id);
    expect(revokeRes.status).toBe(204);

    const after = await useToken(token);
    expect(after.status).toBe(401);
  });

  it("returns 404 when revoking another user's PAT", async () => {
    const a = (await (await issuePat(USER_A_TOKEN, { name: "a" })).json()) as PatIssueResponse;
    const res = await revokePatReq(USER_B_TOKEN, a.id);
    // Use 404 (not 403) so the existence of A's token id is not leaked
    // to user B.
    expect(res.status).toBe(404);
  });

  it("returns 404 when revoking a non-existent PAT id", async () => {
    const res = await revokePatReq(USER_A_TOKEN, "pat_does_not_exist");
    expect(res.status).toBe(404);
  });

  it("marks revoked_at in subsequent list responses", async () => {
    const issueRes = await issuePat(USER_A_TOKEN, { name: "trackme" });
    const { id } = (await issueRes.json()) as PatIssueResponse;

    await revokePatReq(USER_A_TOKEN, id);

    const listRes = await listPats(USER_A_TOKEN);
    const list = (await listRes.json()) as { pats: PatListItem[] };
    const found = list.pats.find((p) => p.id === id);
    expect(found).toBeDefined();
    expect(found?.revoked_at).not.toBeNull();
  });

  it("revoking again is idempotent (404 on second call)", async () => {
    const issueRes = await issuePat(USER_A_TOKEN, { name: "double-revoke" });
    const { id } = (await issueRes.json()) as PatIssueResponse;

    expect((await revokePatReq(USER_A_TOKEN, id)).status).toBe(204);
    expect((await revokePatReq(USER_A_TOKEN, id)).status).toBe(404);
  });
});

describe("PAT identity-header stripping — defense in depth", () => {
  it("strips client-supplied identity headers when a PAT is used", async () => {
    const issueRes = await issuePat(USER_A_TOKEN);
    const { token } = (await issueRes.json()) as PatIssueResponse;

    await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-User-Id": "attacker",
          "X-Org-Id": "evil-org",
          "X-User-Email": "attacker@evil.com",
        },
      }),
    );

    const calls = proxiedCalls();
    expect(calls).toHaveLength(1);
    const [, fetchOptions] = calls[0] as [unknown, RequestInit];
    const headers = fetchOptions.headers as Headers;
    expect(headers.get("X-User-Id")).toBe(USER_A.sub);
    expect(headers.get("X-Org-Id")).toBe(USER_A.org_id);
    expect(headers.get("X-User-Email")).toBe(USER_A.email);
  });
});
