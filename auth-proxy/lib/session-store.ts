/**
 * Server-held session store for auth-proxy.
 *
 * Per OQ1 (b) in `docs/feature/auth-proxy-mints-user-tokens/design/design.md`
 * §7.1, the WorkOS `refresh_token` is held server-side keyed by a `sid`
 * (session id) claim baked into the auth-proxy user-token. The FE never
 * sees a WorkOS token; only the local auth-proxy JWT leaves the server.
 *
 * Persistence shape: in-memory Map by default, JSONL on disk when
 * `SESSION_STORE_PATH` is set. JSONL is append-only with last-write-wins
 * on replay. Every read/write tails any new bytes appended since the
 * previous call, so a second replica sharing the same file observes
 * writes (and delete tombstones) from peer replicas without restart —
 * the load-bearing property for multi-replica deployments.
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";

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
let cachedPath: string | null = null;
let readOffset = 0;
let partialLine = "";

function storePath(): string | null {
  return process.env.SESSION_STORE_PATH || null;
}

type JsonlEntry =
  | { op: "set"; sid: string; payload: SessionPayload }
  | { op: "delete"; sid: string };

/**
 * Catch up the in-memory map to any bytes appended to the JSONL file
 * since the last call. Called before every read or write so a replica
 * sharing the file with peers observes their writes incrementally —
 * without this, a process that has cached the store can never see a
 * peer's delete tombstone.
 */
function syncFromDisk(): void {
  const path = storePath();
  if (!path) return;

  // Path changed (test reset, env swap): replay from byte zero.
  if (cachedPath !== path) {
    entries.clear();
    cachedPath = path;
    readOffset = 0;
    partialLine = "";
  }

  if (!existsSync(path)) return;

  const size = statSync(path).size;
  // External truncation (rare — only test fixtures): start over.
  if (size < readOffset) {
    entries.clear();
    readOffset = 0;
    partialLine = "";
  }
  if (size === readOffset) return;

  const fd = openSync(path, "r");
  try {
    const newBytes = size - readOffset;
    const buf = Buffer.alloc(newBytes);
    const n = readSync(fd, buf, 0, newBytes, readOffset);
    readOffset += n;
    partialLine += buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }

  let nl: number;
  while ((nl = partialLine.indexOf("\n")) >= 0) {
    const line = partialLine.slice(0, nl).trim();
    partialLine = partialLine.slice(nl + 1);
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as JsonlEntry;
      if (entry.op === "set") {
        entries.set(entry.sid, entry.payload);
      } else if (entry.op === "delete") {
        entries.delete(entry.sid);
      }
    } catch {
      // Skip unparseable lines rather than failing boot.
    }
  }
}

function persist(entry: JsonlEntry): void {
  const path = storePath();
  if (!path) return;
  const dir = dirname(path);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf8");
}

export function setSession(sid: string, payload: SessionPayload): void {
  syncFromDisk();
  entries.set(sid, payload);
  persist({ op: "set", sid, payload });
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
  syncFromDisk();
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
  syncFromDisk();
  const existed = entries.delete(sid);
  if (existed) {
    persist({ op: "delete", sid });
  }
  return existed;
}

export function _resetForTests(): void {
  entries.clear();
  cachedPath = null;
  readOffset = 0;
  partialLine = "";
}
