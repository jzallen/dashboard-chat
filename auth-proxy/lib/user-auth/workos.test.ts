/**
 * Test plan — `WorkOsUserAuthProvider`
 *
 * Source under test: `auth-proxy/lib/user-auth/workos.ts`
 *
 * The production user-auth provider. Exchanges WorkOS auth codes for tokens,
 * stores the WorkOS `refresh_token` in the session-store keyed by `sid`, and
 * mints a local auth-proxy JWT to return to the FE. Per OQ1 (b): **the WorkOS
 * refresh_token never leaves the server.** Row #10 is the invariant that
 * makes the OQ1 (b) posture real — if it can fail, the FE can hold the
 * WorkOS token and the security upgrade dissolves.
 *
 * All WorkOS HTTP calls go through an injected `fetch` port (mirroring
 * `backend/app/auth/workos_provider.py:89-120`'s use of an HTTP client).
 * Tests mock the fetch port; **no test in this file hits the real WorkOS** —
 * doing so would defeat the dev-mode-isolation principle that motivated this
 * design.
 *
 * | # | Scenario | Input | Expected |
 * |---|---|---|---|
 * | 1 | `handleCallback` exchanges code+state with WorkOS `authenticate` | `code, state`; mock fetch returns `{access_token, refresh_token, user: {...}}` | Single `POST` to `<WORKOS_BASE>/user_management/authenticate` with `code, state, client_id, client_secret`; returns locally-minted JWT |
 * | 2 | `handleCallback` stores the WorkOS refresh_token in the session-store | as #1 | Session-store has an entry for the new `sid` with `workos_refresh_token` from the WorkOS response |
 * | 3 | `handleCallback` returns ONLY the local JWT (NOT the WorkOS token) | as #1 | Returned access_token decodes to `kid=auth-proxy:user:1`; the WorkOS `refresh_token` is NOT present in the return value |
 * | 4 | `refresh` looks up the WorkOS refresh_token by `sid` | `refresh(sid)` for an `sid` whose session-store entry has `workos_refresh_token: "wos-r-123"` | Outbound WorkOS call carries `refresh_token: "wos-r-123"` |
 * | 5 | `refresh` rotates the stored WorkOS refresh_token | mock WorkOS returns a new `refresh_token: "wos-r-456"` | Session-store entry for `sid` now has `workos_refresh_token: "wos-r-456"` (old value gone) |
 * | 6 | `refresh` returns a freshly-minted local JWT, NOT the WorkOS token | as #4 | Returned access_token verifies via auth-proxy keypair; no WorkOS token in response |
 * | 7 | `refresh` rejects missing sid | `refresh("never-existed")` | Throws/rejects with `invalid_session`; no WorkOS call made |
 * | 8 | `refresh` rejects expired session | session-store has `expires_at < now` for the sid | Rejects with `invalid_session`; no WorkOS call made |
 * | 9 | `logout` deletes session-store entry AND optionally calls WorkOS revoke | `logout(sid)`, mock revoke endpoint | Session-store `get(sid)` returns null; if `WORKOS_REVOKE_ON_LOGOUT=true`, WorkOS `revoke` was called |
 * | 10 | **Invariant: WorkOS refresh_token never appears outside the session-store** | inspect every return value across all test rows | grep-style assertion: no return value, no thrown error message, no log line contains the literal string of the WorkOS refresh_token |
 * | 11 | WorkOS 401 surfaces as `unauthorized` | mock fetch returns 401 | Method rejects with `unauthorized`; session-store untouched |
 * | 12 | WorkOS 5xx surfaces as `service_error` | mock fetch returns 503 | Method rejects with `service_error`; session-store untouched |
 * | 13 | Network error surfaces as `service_error` | mock fetch throws `new Error("ECONNREFUSED")` | Method rejects with `service_error`; session-store untouched |
 * | 14 | Concurrent `refresh` calls for the same sid: no torn state | two `refresh(sid)` calls in `Promise.all` | Both either resolve cleanly or one fails; session-store ends in a consistent state (one refresh_token, one expires_at) |
 *
 * **Notes for the agent:**
 * - Construct the provider with `{fetch: mockFetch, sessionStore: inMemoryStore, config: {...}}` — DI everything. No real fetch, no JSONL.
 * - Row #10 is the security invariant. Consider a `serializeForTransport()` helper or just inspect every method's return shape.
 * - For row #14: WorkOS may or may not support idempotent refresh. The implementation can use a per-sid mutex; the test asserts the OUTCOME (consistent state), not the mechanism.
 * - Do not commit a fixture WORKOS_CLIENT_ID or secret — use `"test-client"` / `"test-secret"` strings.
 */

import { describe } from "vitest";

describe.todo("WorkOsUserAuthProvider — see test plan in the file's top docstring");
