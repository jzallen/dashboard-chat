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
 * | 1 | Mints a token with every required claim | `{sub, email, name, org_id, sid}` (all populated) | Decoded JWT carries `sub`, `email`, `name`, `org_id`, `sid`, plus `iss`, `aud`, `iat`, `exp` |
 * | 2 | Uses the user-token kid, distinct from M2M and PAT | any valid input | Header `kid === "auth-proxy:user:1"` (not `"auth-proxy:m2m:1"` or any PAT kid) |
 * | 3 | Signs through the shared keypair | any valid input | Signature verifies against `getKeypair().publicKey` (same instance M2M/PAT use) |
 * | 4 | Honors `USER_TOKEN_TTL_SECONDS` env var | env set to `7200`, valid input | `exp - iat === 7200` |
 * | 5 | Falls back to a sane TTL default when env unset | env unset, valid input | `exp - iat === <documented default>` (likely `3600`) |
 * | 6 | Throws when `sub` is missing | `{email, name, org_id, sid}` (no `sub`) | Throws with a clear "missing required claim" message |
 * | 7 | Throws when `org_id` is missing | `{sub, email, name, sid}` (no `org_id`) | Throws — `org_id` is load-bearing for ADR-029 invariant 1 |
 * | 8 | Throws when `sid` is missing | `{sub, email, name, org_id}` (no `sid`) | Throws — `sid` is mandatory for the OQ1 (b) server-held session model |
 * | 9 | Round-trips through auth-proxy's verifyToken | freshly minted token | `verifyToken` returns the same claims that were minted, no error |
 * | 10 | `iat` is current time; `nbf` ≤ now | valid input | `iat` within ±2s of `Date.now() / 1000`; if `nbf` set, `nbf` ≤ `iat` |
 *
 * **Notes for the agent:**
 * - Mirror the env-reset pattern from `m2m.test.ts:23-25` (`ORIG_ENV = { ...process.env }` + `resetEnv()`).
 * - Use `_resetForTests()` from `keypair.ts` between tests to avoid keypair carry-over.
 * - Vitest, vanilla `import { describe, it, expect, beforeEach, afterEach } from "vitest"`. No `jose` mocks — verify the real signature.
 */

import { describe } from "vitest";

describe.todo("mintUserToken — see test plan in the file's top docstring");
