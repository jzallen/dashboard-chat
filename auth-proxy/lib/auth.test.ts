/**
 * Regression test plan — `verifyToken` org_id handling
 *
 * Source under test: `auth-proxy/lib/auth.ts`
 *
 * Guards the cross-tenant escalation vector: a token whose `org_id` claim is
 * present but not a string used to be cast (`(payload.org_id as string) || ""`,
 * a compile-time-only cast) and injected verbatim onto the upstream
 * `X-Org-Id` header — letting a number/object/array masquerade as a tenant.
 *
 * The contract verified here:
 *   - org_id PRESENT but non-string  -> verifyToken rejects (type confusion).
 *   - org_id ABSENT or empty string  -> resolves to "" (the legitimate
 *     org-less signal the onboarding flow depends on; auth-proxy mints
 *     `org_id: ""` for no-org WorkOS users and the backend reads an absent/
 *     empty X-Org-Id as "no tenant").
 *   - org_id a non-empty string      -> passes through unchanged.
 *
 * Tokens are hand-minted with the user-token kid (`auth-proxy:user:1`) signed
 * against the shared in-process keypair, so they flow through verifyToken's
 * `isUserToken` dispatch in AUTH_MODE=dev (issuer "auth-proxy", aud "dev-client").
 */

import { SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyToken } from "./auth.ts";
import { _resetKeypairForTests,getKeypair } from "./keypair.ts";

const USER_TOKEN_KID = "auth-proxy:user:1";

const ORIG_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith("M2M_") ||
      key.startsWith("USER_TOKEN_") ||
      key === "AUTH_MODE" ||
      key === "AUTH_PROXY_KEYPAIR_PATH" ||
      key === "WORKOS_CLIENT_ID"
    ) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (
      k.startsWith("M2M_") ||
      k.startsWith("USER_TOKEN_") ||
      k === "AUTH_MODE" ||
      k === "AUTH_PROXY_KEYPAIR_PATH" ||
      k === "WORKOS_CLIENT_ID"
    ) {
      if (v !== undefined) process.env[k] = v;
    }
  }
}

/**
 * Mint a user-kid token carrying an arbitrary `org_id` claim shape so the
 * type-confusion paths can be exercised directly. `org_id === MISSING` omits
 * the claim entirely.
 */
const MISSING = Symbol("missing");
async function mintWithOrgId(orgId: unknown): Promise<string> {
  const { privateKey } = await getKeypair();
  const claims: Record<string, unknown> = {
    email: "alice@example.com",
    name: "Alice",
    sid: "sid-xyz",
  };
  if (orgId !== MISSING) claims.org_id = orgId;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: USER_TOKEN_KID })
    .setSubject("user-abc")
    .setIssuer("auth-proxy")
    .setAudience("dev-client")
    .setIssuedAt()
    .setExpirationTime("3600s")
    .sign(privateKey);
}

beforeEach(() => {
  resetEnv();
  _resetKeypairForTests();
  process.env.AUTH_MODE = "dev";
});

afterEach(() => {
  resetEnv();
  _resetKeypairForTests();
});

describe("verifyToken — org_id claim validation", () => {
  it("rejects a token whose org_id is a number", async () => {
    const token = await mintWithOrgId(12345);
    await expect(verifyToken(token)).rejects.toThrow();
  });

  it("rejects a token whose org_id is an object", async () => {
    const token = await mintWithOrgId({ injected: true });
    await expect(verifyToken(token)).rejects.toThrow();
  });

  it("rejects a token whose org_id is an array", async () => {
    const token = await mintWithOrgId(["a", "b"]);
    await expect(verifyToken(token)).rejects.toThrow();
  });

  it("allows an absent org_id and resolves it to the empty org-less signal", async () => {
    const token = await mintWithOrgId(MISSING);
    const identity = await verifyToken(token);
    expect(identity.orgId).toBe("");
  });

  it("allows an empty-string org_id (the org-less onboarding signal)", async () => {
    const token = await mintWithOrgId("");
    const identity = await verifyToken(token);
    expect(identity.orgId).toBe("");
  });

  it("passes a non-empty string org_id through unchanged", async () => {
    const token = await mintWithOrgId("org-1");
    const identity = await verifyToken(token);
    expect(identity.orgId).toBe("org-1");
  });
});
