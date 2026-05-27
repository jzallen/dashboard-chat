/**
 * Server-held session store for auth-proxy.
 *
 * Per OQ1 (b) in `docs/feature/auth-proxy-mints-user-tokens/design/design.md`
 * §7.1, the WorkOS `refresh_token` is held server-side keyed by a `sid`
 * (session id) claim baked into the auth-proxy user-token. The FE never
 * sees a WorkOS token; only the local auth-proxy JWT leaves the server.
 *
 * Persistence shape mirrors `lib/pat.ts`: in-memory Map by default,
 * JSONL on disk when `SESSION_STORE_PATH` is set. JSONL is append-only
 * with last-write-wins on replay, so a deploy can hot-reload the store
 * by simply rebooting against the same file.
 */

export interface SessionUserClaims {
  sub: string;
  email: string;
  name: string;
  org_id: string;
}

export interface SessionPayload {
  workos_refresh_token: string;
  /** Epoch-second timestamp when the session is no longer valid. */
  expires_at: number;
  user_claims: SessionUserClaims;
}

const entries = new Map<string, SessionPayload>();

export function setSession(sid: string, payload: SessionPayload): void {
  entries.set(sid, payload);
}

export type SessionLookup =
  | { status: "valid"; payload: SessionPayload }
  | { status: "expired" }
  | { status: "missing" };

/**
 * Look up a session and report whether it was missing, expired, or
 * still valid. Expired sessions are lazily evicted as a side-effect.
 * Callers that need a tagged outcome (e.g. /api/auth/refresh, which
 * distinguishes "session_expired" from "invalid_session") use this
 * directly; ergonomic `getSession` is a thin wrapper.
 */
export function getSessionStatus(sid: string): SessionLookup {
  const entry = entries.get(sid);
  if (!entry) return { status: "missing" };
  if (entry.expires_at < Math.floor(Date.now() / 1000)) {
    entries.delete(sid);
    return { status: "expired" };
  }
  return { status: "valid", payload: entry };
}

export function getSession(sid: string): SessionPayload | null {
  const lookup = getSessionStatus(sid);
  return lookup.status === "valid" ? lookup.payload : null;
}

/**
 * Forget the session entry for `sid`. Idempotent: deleting a sid that
 * was never set (or already deleted) is a no-op. Callers shouldn't
 * branch on the boolean unless they specifically need to distinguish
 * the first delete from a duplicate.
 */
export function deleteSession(sid: string): boolean {
  return entries.delete(sid);
}

export function _resetForTests(): void {
  entries.clear();
}
