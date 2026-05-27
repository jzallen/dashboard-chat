/**
 * Test plan — `post-response-reissue` hook
 *
 * Source under test: `auth-proxy/lib/post-response-reissue.ts`
 *
 * The Stage-2 response-side hook. Observes proxied responses; when the inbound
 * request was `POST /api/orgs` AND the response status is 201 AND the body
 * carries an `org_id`, mints a fresh user-token with the updated `org_id`
 * claim and attaches it to the response as `X-New-Access-Token`. The hook is
 * deliberately path-and-status-specific — generalizing to other
 * scope-changing operations is deferred to OQ2 (org-switch, invite-accept,
 * role-change) at N=3+.
 *
 * The corresponding integration tests are in
 * `auth-proxy/org-create-reissue.test.ts` — particularly the R7 invariant
 * (backend cannot smuggle the header).
 *
 * | # | Scenario | Input | Expected |
 * |---|---|---|---|
 * | 1 | Fires on `POST /api/orgs` 201 | request `POST /api/orgs`, response status 201, body `{id: "org-new", name: "Acme"}` | Mints a new token; adds `X-New-Access-Token` + `X-New-Token-Expires-In` to the response |
 * | 2 | Does NOT fire on `POST /api/orgs` non-201 | response status 400 / 409 / 500 with same body | No new headers; original response passes through unchanged |
 * | 3 | Does NOT fire on `GET /api/orgs` | request `GET /api/orgs`, any status | No new headers |
 * | 4 | Does NOT fire on other paths | request `POST /api/projects`, status 201 | No new headers; org-create is the only path-specific hook |
 * | 5 | Extracts `org_id` from flat body shape | body `{id: "org-1", name: "..."}` | Minted token has `org_id: "org-1"` |
 * | 6 | Extracts `org_id` from JSON:API body shape | body `{data: {id: "org-1", attributes: {name: "..."}}}` | Minted token has `org_id: "org-1"` (mirror of `CREATE_ORG_STATUS_RULES` body parsing) |
 * | 7 | Missing `org_id` in body: hook does NOT fire | body `{name: "Acme"}` (no id) | No new headers; warning logged |
 * | 8 | Malformed JSON body: hook does NOT fire | body = `"<<<not-json>>>"` | No throw, no new headers; response passes through |
 * | 9 | Preserves non-org claims (`sub`, `email`, `sid`) | inbound token has `{sub: "u-1", email: "a@b", sid: "s-1", org_id: ""}` | Minted token has same `sub`, `email`, `sid`; only `org_id` updated |
 * | 10 | Adds `X-New-Token-Expires-In` matching the new token's TTL | as #1, with `USER_TOKEN_TTL_SECONDS=3600` | Header `X-New-Token-Expires-In: 3600` (or the configured TTL) |
 * | 11 | Does NOT mutate the response body | as #1 | Response body bytes unchanged before vs. after the hook |
 * | 12 | Inbound token missing (anonymous request) — hook does NOT fire | request has no Bearer (e.g., `POST /api/orgs` via PUBLIC_PATHS — shouldn't happen, defensive) | No new headers; nothing to mint from |
 *
 * **Notes for the agent:**
 * - This is a pure module test — DI everything. The hook is constructed with a `mintUserToken` port (or the real `lib/user-token.ts` since it's also pure). Don't spin up the full Hono app.
 * - For row #11: hash the body buffer before and after; assert equality.
 * - For row #6: this codebase has both flat and JSON:API responses (see `backend/app/auth/dev_provider.py` shapes); the hook must handle both.
 */

import { describe } from "vitest";

describe.todo("post-response-reissue — see test plan in the file's top docstring");
