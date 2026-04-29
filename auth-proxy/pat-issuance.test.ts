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
 *
 * The whole suite runs twice — once under `AUTH_MODE=dev` (BACKEND_URL
 * JWKS) and once under `AUTH_MODE=workos` (WorkOS JWKS) — so the
 * issuer is exercised against both validation paths the proxy actually
 * runs in production. ADR-016 requires dev-mode parity here so local
 * + CI exercise the same code paths the headless flow uses in prod.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { exportJWK, generateKeyPair, type KeyLike, SignJWT } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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
      key === "AUTH_PROXY_KEYPAIR_PATH" ||
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
      k === "AUTH_PROXY_KEYPAIR_PATH" ||
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

interface ModeConfig {
  /** Display label for `describe.each`. */
  name: "dev" | "workos";
  /** Value to set in `process.env.AUTH_MODE`. */
  authMode: "dev" | "workos";
  /** `iss` claim baked into the synthetic user JWTs. */
  issuer: string;
  /** `aud` claim baked into the synthetic user JWTs. */
  audience: string;
  /** Env applied per mode so `verifyToken` resolves the matching JWKS URL. */
  env: Record<string, string>;
  /** URL the test's mocked `fetch` should serve the JWKS from. */
  jwksUrl: string;
  /** PAT id prefix that issuance must produce in this mode. */
  expectIdPrefix: "pat_" | "dev-pat-";
}

const WORKOS_CLIENT_ID = "test-workos-client";

const MODES: ModeConfig[] = [
  {
    name: "dev",
    authMode: "dev",
    issuer: "http://localhost:8000",
    audience: "dev-client",
    env: {
      AUTH_MODE: "dev",
      BACKEND_URL: "http://localhost:8000",
      JWKS_URL: "http://localhost:8000/.well-known/jwks.json",
    },
    jwksUrl: "http://localhost:8000/.well-known/jwks.json",
    expectIdPrefix: "dev-pat-",
  },
  {
    name: "workos",
    authMode: "workos",
    issuer: `https://api.workos.com/user_management/${WORKOS_CLIENT_ID}`,
    audience: WORKOS_CLIENT_ID,
    env: {
      AUTH_MODE: "workos",
      WORKOS_CLIENT_ID,
      // Pin JWKS_URL so the test's mocked fetch can serve it without
      // touching the real WorkOS endpoint.
      JWKS_URL: `https://api.workos.com/sso/jwks/${WORKOS_CLIENT_ID}`,
    },
    jwksUrl: `https://api.workos.com/sso/jwks/${WORKOS_CLIENT_ID}`,
    expectIdPrefix: "pat_",
  },
];

let userPrivateKey: KeyLike | Uint8Array;
let userJwks: { keys: object[] };

beforeAll(async () => {
  // One JWKS keypair is shared across both modes — the issuer/audience
  // claims differ, but the signing key the proxy fetches over JWKS is
  // the same. This mirrors how a real deployment treats key material.
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  userPrivateKey = privateKey;
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-user-key";
  jwk.alg = "RS256";
  jwk.use = "sig";
  userJwks = { keys: [jwk] };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

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

/** Filter the proxied (non-JWKS) fetch calls. */
function proxiedCalls(): unknown[][] {
  return mockFetch.mock.calls.filter((call) => {
    const url = String(call[0]);
    return (
      !url.endsWith("/.well-known/jwks.json") && !url.includes("/sso/jwks/")
    );
  });
}

describe.each(MODES)("PAT lifecycle — AUTH_MODE=$name", (mode) => {
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
      .setIssuer(mode.issuer)
      .setAudience(mode.audience)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(userPrivateKey);
  }

  beforeEach(async () => {
    resetEnv();
    resetM2m();
    resetPat();
    vi.clearAllMocks();

    for (const [k, v] of Object.entries(mode.env)) {
      process.env[k] = v;
    }
    process.env.M2M_ENABLED = "true";

    USER_A_TOKEN = await signUserJwt(USER_A);
    USER_B_TOKEN = await signUserJwt(USER_B);

    // Default fetch handler: serve the matching JWKS, otherwise return
    // ok for proxied paths. Both the dev backend and the WorkOS sso/jwks
    // routes funnel into the same JWK set in this test rig.
    mockFetch.mockImplementation(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : (input as URL).toString
            ? (input as URL).toString()
            : (input as Request).url;
      if (
        url === mode.jwksUrl ||
        url.endsWith("/.well-known/jwks.json") ||
        url.includes("/sso/jwks/")
      ) {
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
      expect(body.id.startsWith(mode.expectIdPrefix)).toBe(true);
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
      const a1 = (await (
        await issuePat(USER_A_TOKEN, { name: "a1" })
      ).json()) as PatIssueResponse;
      const a2 = (await (
        await issuePat(USER_A_TOKEN, { name: "a2" })
      ).json()) as PatIssueResponse;
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
      const list = (await listRes.json()) as {
        pats: Record<string, unknown>[];
      };
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
      const a = (await (
        await issuePat(USER_A_TOKEN, { name: "a" })
      ).json()) as PatIssueResponse;
      const res = await revokePatReq(USER_B_TOKEN, a.id);
      // Use 404 (not 403) so the existence of A's token id is not leaked
      // to user B.
      expect(res.status).toBe(404);
    });

    it("returns 404 when revoking a non-existent PAT id", async () => {
      const res = await revokePatReq(
        USER_A_TOKEN,
        `${mode.expectIdPrefix}does_not_exist`,
      );
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
});

/**
 * Restart-survival: an issued PAT must still authenticate after the
 * auth-proxy process restarts, provided both the keypair and the PAT
 * store are configured to persist. We simulate the restart by clearing
 * the in-memory state of both modules (`resetPat()` + `resetM2m()`),
 * then sending the previously-issued token as a Bearer to a protected
 * endpoint. With `AUTH_PROXY_KEYPAIR_PATH` set the keypair is reloaded
 * from disk; with `PAT_STORE_PATH` set the PAT records replay from
 * JSONL. Both must hold for the token to validate end-to-end.
 *
 * Single AUTH_MODE here (dev) — the keypair persistence path is
 * mode-independent, the dev-issuer JWT path is already exercised
 * exhaustively in the per-mode block above.
 */
describe("PAT restart-survival — AUTH_PROXY_KEYPAIR_PATH persists keypair", () => {
  let dir: string;
  let keypairPath: string;
  let storePath: string;
  let userToken = "";

  async function signUserJwt(claims: {
    sub: string;
    org_id: string;
    email: string;
  }): Promise<string> {
    return new SignJWT({ org_id: claims.org_id, email: claims.email })
      .setProtectedHeader({ alg: "RS256", kid: "test-user-key" })
      .setSubject(claims.sub)
      .setIssuer("http://localhost:8000")
      .setAudience("dev-client")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(userPrivateKey);
  }

  beforeEach(async () => {
    resetEnv();
    resetM2m();
    resetPat();
    vi.clearAllMocks();

    dir = mkdtempSync(join(tmpdir(), "auth-proxy-pat-restart-"));
    keypairPath = join(dir, "keypair.json");
    storePath = join(dir, "pats.jsonl");

    process.env.AUTH_MODE = "dev";
    process.env.BACKEND_URL = "http://localhost:8000";
    process.env.JWKS_URL = "http://localhost:8000/.well-known/jwks.json";
    process.env.M2M_ENABLED = "true";
    process.env.AUTH_PROXY_KEYPAIR_PATH = keypairPath;
    process.env.PAT_STORE_PATH = storePath;

    userToken = await signUserJwt(USER_A);

    mockFetch.mockImplementation(async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : (input as URL).toString
            ? (input as URL).toString()
            : (input as Request).url;
      if (
        url.endsWith("/.well-known/jwks.json") ||
        url.includes("/sso/jwks/")
      ) {
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
    rmSync(dir, { recursive: true, force: true });
  });

  it("issued PAT still authenticates after a simulated restart", async () => {
    // Issue a PAT.
    const issueRes = await app.fetch(
      new Request("http://localhost/api/auth/pats", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ name: "long-lived" }),
      }),
    );
    expect(issueRes.status).toBe(201);
    const { token } = (await issueRes.json()) as PatIssueResponse;

    // Simulate auth-proxy restart: drop in-memory keypair AND records.
    // Records will replay from PAT_STORE_PATH; keypair will reload
    // from AUTH_PROXY_KEYPAIR_PATH on next use.
    resetPat();
    resetM2m();

    // The persisted env must remain set to mirror a real restart that
    // brought the same env back up.
    process.env.AUTH_MODE = "dev";
    process.env.AUTH_PROXY_KEYPAIR_PATH = keypairPath;
    process.env.PAT_STORE_PATH = storePath;
    process.env.BACKEND_URL = "http://localhost:8000";
    process.env.JWKS_URL = "http://localhost:8000/.well-known/jwks.json";

    const after = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(after.status).toBe(200);
  });

  it("without AUTH_PROXY_KEYPAIR_PATH, simulated restart breaks the PAT (the bug)", async () => {
    delete process.env.AUTH_PROXY_KEYPAIR_PATH;
    resetPat();
    resetM2m();

    // Issue a PAT in this no-persistence configuration.
    const issueRes = await app.fetch(
      new Request("http://localhost/api/auth/pats", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify({ name: "ephemeral" }),
      }),
    );
    expect(issueRes.status).toBe(201);
    const { token } = (await issueRes.json()) as PatIssueResponse;

    // Simulate restart: keypair regenerates because nothing is persisted.
    resetPat();
    resetM2m();
    process.env.AUTH_MODE = "dev";
    process.env.BACKEND_URL = "http://localhost:8000";
    process.env.JWKS_URL = "http://localhost:8000/.well-known/jwks.json";
    // Still no AUTH_PROXY_KEYPAIR_PATH.

    const after = await app.fetch(
      new Request("http://localhost/api/projects", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    // Signature verification fails against a fresh keypair → 401.
    expect(after.status).toBe(401);
  });
});
