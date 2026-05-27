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
 * | # | Group | Scenario | Input | Expected |
 * |---|---|---|---|---|
 * | 1 | login | dev mode returns FE-redirect URL | `GET /api/auth/login`, `AUTH_MODE=dev` | 200 with `{url: "<dev-redirect>"}` (or 302 redirect) |
 * | 2 | login | workos mode returns WorkOS authorize URL | `GET /api/auth/login`, `AUTH_MODE=workos` | 200/302 with URL = `https://api.workos.com/user_management/authorize?client_id=…&redirect_uri=…&state=…` |
 * | 3 | login | workos URL includes a non-empty CSRF state | as #2 | `state` query param is present, non-empty, opaque |
 * | 4 | callback | dev mode mints with `dev-auth-code` | `POST /api/auth/callback {code: "dev-auth-code"}`, `AUTH_MODE=dev` | 200 with `{access_token, expires_in}`; token verifies via auth-proxy keypair; session-store has an entry for the issued `sid` |
 * | 5 | callback | workos mode exchanges with WorkOS | `POST /api/auth/callback {code, state}`, `AUTH_MODE=workos`, mocked WorkOS happy path | 200 with local JWT; WorkOS `authenticate` was called once with the right body |
 * | 6 | callback | state mismatch rejected | as #5 but with `state` value that doesn't match what `login` issued | 400 with `state_mismatch`; no token issued |
 * | 7 | callback | dev mode refuses to mint when `AUTH_MODE != "dev"` | `POST /api/auth/callback {code: "dev-auth-code"}`, `AUTH_MODE=workos` | 401 or 400 — dev path inactive |
 * | 8 | refresh | valid sid mints fresh access_token | `POST /api/auth/refresh` with Bearer = user-token containing `sid` that's in the session store | 200 with new `access_token`; new token has different `iat` but same `sub`/`org_id`/`sid` |
 * | 9 | refresh | invalid sid returns 401 | Bearer JWT carries `sid` not in the session store | 401 `invalid_session` |
 * | 10 | refresh | post-logout sid returns 401 | call `/logout` first, then `/refresh` with same sid | 401 `invalid_session` |
 * | 11 | refresh | expired session returns 401 | session-store entry's `expires_at < now` | 401 `session_expired`; entry deleted lazily |
 * | 12 | refresh | rotates WorkOS refresh_token in session store | mocked WorkOS returns new `refresh_token: "wos-r-456"` | Session-store entry's `workos_refresh_token` is now `"wos-r-456"` |
 * | 13 | refresh | **does NOT return WorkOS refresh_token in response** | as #12 | Response body contains `access_token` (local JWT) but no `refresh_token` field, and no header carries it. OQ1 (b) invariant. |
 * | 14 | logout | deletes session and returns 204 | `POST /api/auth/logout` with Bearer = valid user-token | 204; session-store `get(sid)` returns null |
 * | 15 | logout | idempotent on already-logged-out | call `/logout` twice with the same token | First: 204. Second: 204 (or 401 if Bearer validation strict — pick one and assert) |
 * | 16 | round-trip | issued token authenticates on a protected endpoint | issue via `/callback` → use as Bearer on a protected mock endpoint | 200 from the protected endpoint; X-User-Id / X-Org-Id / X-User-Email headers forwarded |
 * | 17 | round-trip | tampered token returns 401 | flip a bit in the JWT signature | 401 at the protected endpoint |
 * | 18 | round-trip | claims-modified token (re-signed by different key) rejected | mint with a foreign keypair, same payload shape | 401 — kid lookup fails / signature invalid |
 * | 19 | security | **strips client-supplied identity headers** | request includes `X-User-Id: attacker-001` AND a valid Bearer | Upstream receives `X-User-Id` from the *token*, not from the client header. Mirror of `pat-issuance.test.ts:459-498`. |
 * | 20 | dev parity | dev path works without WorkOS env vars set | unset `WORKOS_API_KEY` etc.; `POST /api/auth/callback {code: "dev-auth-code"}`, `AUTH_MODE=dev` | 200 with local JWT; no WorkOS fetch was attempted (mock fetch records zero calls) |
 *
 * **Notes for the agent:**
 * - Mirror the harness shape from `m2m-issuance.test.ts:228+` (round-trip section) for rows #16–#19.
 * - For #19: use `pat-issuance.test.ts:459-498` as the precedent — the test pattern for "client header is stripped" is established.
 * - Mock WorkOS at the `fetch` boundary. Inject `fetch` via the same DI seam the providers use; do not monkey-patch `globalThis.fetch`.
 * - Use `_resetForTests()` between tests (keypair, session-store, env). See `m2m-issuance.test.ts` for the precedent.
 * - For #11 (expired session): set a small TTL in the test or stub `Date.now()` via vitest's fake timers.
 */

import { describe } from "vitest";

describe.todo("user-token issuance endpoints — see test plan in the file's top docstring");
