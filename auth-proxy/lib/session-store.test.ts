/**
 * Test plan — `session-store`
 *
 * Source under test: `auth-proxy/lib/session-store.ts`
 *
 * Server-held session entries keyed by `sid` — per OQ1 (b) — holding the
 * WorkOS `refresh_token` so the FE never sees it. Mirrors the JSONL persistence
 * pattern from `auth-proxy/lib/pat.ts` (read that module's tests
 * (`pat-issuance.test.ts`) for the persistence + restart-survival pattern).
 * The restart-survival row (#11) is the load-bearing test for the OQ1 (b)
 * production posture — without it, a deploy could silently lose every active
 * session.
 *
 * Payload shape (per the design doc §4.1): `{ workos_refresh_token: string,
 * expires_at: number, user_claims: { sub, email, name, org_id } }`.
 *
 * | # | Scenario | Input | Expected |
 * |---|---|---|---|
 * | 2 | `get` of an unknown sid returns null | `get("never-set")` | Returns `null` (not throws, not undefined) |
 * | 3 | `delete` removes the entry | `set(sid, p)`, then `delete(sid)`, then `get(sid)` | `get` returns `null` |
 * | 4 | `delete` is idempotent on unknown sid | `delete("never-set")` | No throw; subsequent `get` still returns `null` |
 * | 5 | Re-`set` of the same sid replaces the prior value | `set(sid, p1)`, then `set(sid, p2)`, then `get(sid)` | Returns `p2` |
 * | 6 | Expired session returns null on lookup (lazy) | `set(sid, {expires_at: <past>, ...})`, then `get(sid)` | Returns `null`; refresh_token not surfaced |
 * | 7 | Expired session never returns the refresh_token | any expired entry | No code path returns `workos_refresh_token` for an expired entry |
 * | 8 | Empty/missing JSONL file is handled gracefully | construct store with `SESSION_STORE_PATH` pointing at a non-existent file | Empty store; `get(any)` returns `null`; first `set` creates the file |
 * | 9 | Malformed JSONL line is skipped, not fatal | seed file with one valid + one garbled line | Store loads, valid entry retrievable, garbled line ignored (or logged + skipped) |
 * | 10 | Multiple writes append cleanly to JSONL | three sequential `set`s with different sids | File contains three parseable JSONL records; each retrievable |
 * | 11 | **Restart-survival WITH `SESSION_STORE_PATH`** | `set(sid, p)`, simulate restart (`_resetForTests()` + new store), `get(sid)` | Returns `p` — the load-bearing OQ1 (b) test |
 * | 12 | **No survival WITHOUT `SESSION_STORE_PATH`** | env unset; `set(sid, p)`, simulate restart, `get(sid)` | Returns `null` (acceptable for in-memory dev) |
 * | 13 | Two store instances sharing a path see each other's writes | Instance A `set(sid, p)`, Instance B reload, `get(sid)` | Returns `p` (multi-replica via shared persistence) |
 * | 14 | Concurrent writes don't corrupt the JSONL | parallel `set`s on different sids | File remains parseable; both entries retrievable |
 *
 * **Notes for the agent:**
 * - Use `mkdtempSync` + `rmSync` (mirror `m2m.test.ts:1-3`) for isolated temp dirs.
 * - For #11/12: simulate restart by calling `_resetForTests()` (or equivalent) and constructing a fresh store instance reading the same `SESSION_STORE_PATH`. See `pat-issuance.test.ts:500-575` for the restart-survival precedent.
 * - For #14: vitest's parallel-test isolation is *file*-level; concurrency within one test means real `Promise.all` of write calls. Verify the JSONL line count and parseability.
 * - This file probably also exports a `_resetForTests()` similar to `m2m.ts` and `pat.ts`. Symmetry.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetForTests, getSession, setSession } from "./session-store.ts";

const ORIG_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (key === "SESSION_STORE_PATH") delete process.env[key];
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (k === "SESSION_STORE_PATH" && v !== undefined) process.env[k] = v;
  }
}

beforeEach(() => {
  resetEnv();
  _resetForTests();
});

afterEach(() => {
  resetEnv();
  _resetForTests();
});

const VALID_PAYLOAD = {
  workos_refresh_token: "wos-r-abc",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user_claims: {
    sub: "user-1",
    email: "u@example.com",
    name: "U",
    org_id: "org-1",
  },
};

describe("session-store — set/get round trip", () => {
  it("get(sid) returns the same payload that set(sid, payload) stored", () => {
    setSession("sid-1", VALID_PAYLOAD);
    expect(getSession("sid-1")).toEqual(VALID_PAYLOAD);
  });
});
