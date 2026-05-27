/**
 * Test plan — `mintUserToken`
 *
 * Source under test: `auth-proxy/lib/user-token.ts`
 *
 * Companion to `auth-proxy/lib/m2m.test.ts` and `auth-proxy/lib/secrets.test.ts`
 * — same shape (pure module, shared keypair via `getKeypair()`), different
 * minting surface. User tokens carry an extra `sid` claim (the server-held
 * session identifier from `session-store.ts`) per OQ1 (b) — see
 * `docs/feature/auth-proxy-mints-user-tokens/design/design.md` §7.1.
 *
 * | # | Scenario | Input | Expected |
 * |---|---|---|---|
 * | 3 | Signs through the shared keypair | any valid input | Signature verifies against `getKeypair().publicKey` (same instance M2M/PAT use) |
 * | 4 | Honors `USER_TOKEN_TTL_SECONDS` env var | env set to `7200`, valid input | `exp - iat === 7200` |
 * | 5 | Falls back to a sane TTL default when env unset | env unset, valid input | `exp - iat === <documented default>` (likely `3600`) |
 * | 6 | Throws when `sub` is missing | `{email, name, org_id, sid}` (no `sub`) | Throws with a clear "missing required claim" message |
 * | 7 | Throws when `org_id` is missing | `{sub, email, name, sid}` (no `org_id`) | Throws — `org_id` is load-bearing for ADR-029 invariant 1 |
 * | 8 | Throws when `sid` is missing | `{sub, email, name, org_id}` (no `sub`) | Throws — `sid` is mandatory for the OQ1 (b) server-held session model |
 * | 9 | Round-trips through auth-proxy's verifyToken | freshly minted token | `verifyToken` returns the same claims that were minted, no error |
 * | 10 | `iat` is current time; `nbf` ≤ now | valid input | `iat` within ±2s of `Date.now() / 1000`; if `nbf` set, `nbf` ≤ `iat` |
 *
 * **Notes for the agent:**
 * - Mirror the env-reset pattern from `m2m.test.ts:23-25` (`ORIG_ENV = { ...process.env }` + `resetEnv()`).
 * - Use `_resetForTests()` from `keypair.ts` between tests to avoid keypair carry-over.
 * - Vitest, vanilla `import { describe, it, expect, beforeEach, afterEach } from "vitest"`. No `jose` mocks — verify the real signature.
 */

import { decodeJwt, decodeProtectedHeader } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetForTests as resetM2m } from "./m2m.ts";
import { mintUserToken } from "./user-token.ts";

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

beforeEach(() => {
  resetEnv();
  resetM2m();
  process.env.AUTH_MODE = "dev";
});

afterEach(() => {
  resetEnv();
  resetM2m();
});

const VALID_CLAIMS = {
  sub: "user-abc",
  email: "alice@example.com",
  name: "Alice",
  org_id: "org-1",
  sid: "sid-xyz",
};

describe("mintUserToken — claim shape", () => {
  it("mints a token carrying every required claim plus jwt registered fields", async () => {
    const { token } = await mintUserToken(VALID_CLAIMS);

    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);

    const payload = decodeJwt(token);
    expect(payload.sub).toBe(VALID_CLAIMS.sub);
    expect(payload.email).toBe(VALID_CLAIMS.email);
    expect(payload.name).toBe(VALID_CLAIMS.name);
    expect(payload.org_id).toBe(VALID_CLAIMS.org_id);
    expect(payload.sid).toBe(VALID_CLAIMS.sid);
    expect(typeof payload.iss).toBe("string");
    expect(typeof payload.aud).toBe("string");
    expect(typeof payload.iat).toBe("number");
    expect(typeof payload.exp).toBe("number");

    const header = decodeProtectedHeader(token);
    expect(header.alg).toBe("RS256");
    expect(header.kid).toBe("auth-proxy:user:1");
  });
});
