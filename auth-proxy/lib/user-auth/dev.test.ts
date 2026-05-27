/**
 * Test plan — `DevUserAuthProvider`
 *
 * Source under test: `auth-proxy/lib/user-auth/dev.ts`
 *
 * The dev-mode user-auth provider. Mints user tokens from env vars
 * (`DEV_USER_ID`, `DEV_USER_EMAIL`, `DEV_USER_NAME`, `DEV_ORG_ID`) with no
 * network call to WorkOS — the whole reason this provider exists is to keep
 * dev cycles fast and off WorkOS's audit log (per the user's framing during
 * design discussion). Port of the behavior at `backend/app/auth/dev_provider.py`
 * (which is deleted in Stage 3b).
 *
 * Fixture identity per CLAUDE.md:
 * - Default token: `dev-token-static`
 * - Default user: `dev-user-001`
 * - Default org: `dev-org-001`
 *
 * | # | Scenario | Input | Expected |
 * |---|---|---|---|
 * | 1 | `handleCallback` mints with valid auth code | `code: "dev-auth-code"` (or whichever fixture), `AUTH_MODE=dev` | Returns `{access_token, sid, expires_in}`; access_token is a verifiable user-token JWT |
 * | 2 | `handleCallback` rejects unknown codes | `code: "wrong"`, `AUTH_MODE=dev` | Throws/rejects with `invalid_code` (or similar) — no token issued |
 * | 3 | Refuses to mint when `AUTH_MODE != "dev"` | `code: "dev-auth-code"`, `AUTH_MODE=workos` | Throws — security guard; dev provider must be inactive in non-dev mode |
 * | 4 | Mints using env-var identity when present | env: `DEV_USER_ID=alice-007`, `DEV_USER_EMAIL=alice@dev`, `DEV_ORG_ID=org-alice` | Token claims: `sub: "alice-007"`, `email: "alice@dev"`, `org_id: "org-alice"` |
 * | 5 | Falls back to CLAUDE.md fixtures when env vars absent | env: none of the DEV_USER_* / DEV_ORG_ID set | Token claims: `sub: "dev-user-001"`, `org_id: "dev-org-001"`, sane email |
 * | 6 | `refresh` rotates the refresh credential | `refresh(sid)` twice in a row, where `sid` came from a successful callback | Each call returns a *different* refresh marker / advances the session-store's stored token |
 * | 7 | `refresh` updates session-store via the session-store port | a successful `refresh(sid)` call | Session-store entry for `sid` has the post-refresh state (verifiable by reading the store) |
 * | 8 | `logout` deletes the session-store entry by sid | `handleCallback` to create a sid, then `logout(sid)`, then session-store `get(sid)` | `get` returns `null` |
 * | 9 | `logout` is idempotent | `logout(unknown_sid)` and `logout(sid)` twice | No throw on either; subsequent reads remain `null` |
 *
 * **Notes for the agent:**
 * - This file does NOT exercise the HTTP layer — that's `auth-proxy/user-token-issuance.test.ts`. Test the provider class directly.
 * - Inject a session-store double (in-memory) when constructing the provider. Don't write the JSONL file from this test file.
 * - Env-reset pattern: copy from `m2m.test.ts:23-25`. Reset `DEV_USER_*` and `AUTH_MODE` between tests.
 */

import { describe } from "vitest";

describe.todo("DevUserAuthProvider — see test plan in the file's top docstring");
