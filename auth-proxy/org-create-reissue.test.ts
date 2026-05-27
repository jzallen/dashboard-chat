/**
 * Test plan — org-create response-header reissue (Stage 2 integration)
 *
 * Source under test: full Hono app behavior for `POST /api/orgs` 201 →
 * auth-proxy injects `X-New-Access-Token` on the response.
 *
 * Companion to `auth-proxy/lib/post-response-reissue.test.ts` (unit-level for
 * the hook). This file exercises the *integration*: real Hono app + real
 * keypair + a mock upstream backend representing the response from
 * `POST /api/orgs`.
 *
 * **Row #8 is THE load-bearing security test.** R7 in the design risk register
 * (HIGH severity) says backend must not be able to smuggle `X-New-Access-Token`
 * — if it could, a compromised backend could mint arbitrary tokens that the FE
 * silently consumes. The symmetric-strip invariant + this test is the
 * architectural enforcement.
 *
 * | # | Scenario | Input | Expected |
 * |---|---|---|---|
 * | 1 | Authenticated `POST /api/orgs` 201 → `X-New-Access-Token` present | client `POST /api/orgs {name: "Acme"}` with valid Bearer; upstream returns 201 `{id: "org-new", name: "Acme"}` | Response headers include `X-New-Access-Token` (non-empty) and `X-New-Token-Expires-In` |
 * | 2 | New token verifies via auth-proxy keypair | as #1, then verify the new token via `verifyToken` | `kid === "auth-proxy:user:1"`; signature valid; claims decode cleanly |
 * | 3 | New token's `org_id` matches the just-created org | as #1, new org_id is `"org-new"` | New token's `org_id` claim === `"org-new"` |
 * | 4 | Non-org claims preserved (sub, email, sid) | as #1, with original Bearer carrying `{sub: "u-1", email: "a@b", sid: "s-1"}` | New token has same `sub`, `email`, `sid`; only `org_id` differs |
 * | 5 | `POST /api/projects` does NOT add the header | client `POST /api/projects` with valid Bearer; upstream returns 201 | Response has no `X-New-Access-Token` header |
 * | 6 | `POST /api/orgs` 4xx does NOT add the header | client `POST /api/orgs {name: ""}`; upstream returns 400 | Response status passed through (400); no `X-New-Access-Token` |
 * | 7 | `POST /api/orgs` 409 (name taken) does NOT add the header | upstream returns 409 `{error: "name_taken"}` | Response status 409 (or whatever shape `CREATE_ORG_STATUS_RULES` produces); no new header |
 * | 8 | **R7: backend cannot smuggle `X-New-Access-Token`** | upstream's response includes `X-New-Access-Token: malicious-jwt` AND status 200 (so the hook does NOT fire on its own) | Final response to the client has NO `X-New-Access-Token` — auth-proxy strips backend-supplied values on outbound; only auth-proxy's own injection (when it warrants) survives |
 * | 9 | R7 variant: smuggled header on a 201 from a non-org path | upstream's response for `POST /api/projects` includes `X-New-Access-Token: malicious`; status 201 | Final response has NO `X-New-Access-Token` — the hook doesn't fire, AND the smuggled header is stripped |
 * | 10 | R7 variant: smuggled header on `POST /api/orgs` 201 — only auth-proxy's mint survives | upstream's response for `POST /api/orgs` 201 has BOTH a smuggled `X-New-Access-Token: malicious` AND legitimate body | Final response has `X-New-Access-Token` — but the value is auth-proxy's mint (verifies via auth-proxy keypair, NOT the smuggled "malicious" value) |
 * | 11 | Unauthenticated `POST /api/orgs` fails 401 (no token to base reissue on) | no Bearer; `POST /api/orgs` | Response 401 from auth-proxy auth layer; never reaches the hook; no new header (vacuously) |
 * | 12 | Concurrent org-create requests don't cross-contaminate tokens | two valid Bearers (different users) issue `POST /api/orgs` simultaneously | Each response's `X-New-Access-Token` carries the requesting user's `sub`, not the other's |
 *
 * **Notes for the agent:**
 * - The upstream-backend mock should be a Hono sub-app or a fetch mock that returns the configured `{status, body, headers}` for each test. Inject it as the proxy target.
 * - For rows #8/#9/#10: the test mock MUST set the header on the upstream RESPONSE. Verify that auth-proxy's outbound response handling strips it before the client sees it.
 * - The strip-on-outbound behavior (mirror of `auth-proxy/lib/auth.ts:67` inbound stripping) is the implementation companion to this test — they MUST land in the same Stage-2 MR.
 * - Row #12 is concurrency hygiene: vitest doesn't run tests in parallel by default at the test level inside a file, so you'll need `Promise.all(client.request(...))` and assert per-token correctness.
 */

import { describe } from "vitest";

describe.todo("org-create response-header reissue — see test plan in the file's top docstring");
