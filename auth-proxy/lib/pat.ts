/**
 * Personal Access Token (PAT) issuance, storage, and verification.
 *
 * PATs are user-issued, long-lived (or explicitly time-bounded) bearer
 * credentials that the auth-proxy validates the same way it validates
 * any other Bearer: through `verifyToken`. They differ from the OAuth2
 * client_credentials flow in `m2m.ts` in that:
 *   - they are minted by an authenticated end user (not a pre-shared
 *     client_id/secret in env),
 *   - they are persisted (in-memory by default; optionally to a JSONL
 *     file via PAT_STORE_PATH),
 *   - they are revocable immediately — the verify path consults the
 *     store on every request, so a revoked token stops working as soon
 *     as the DELETE returns.
 *
 * Token shape: an RS256 JWT signed with the auth-proxy keypair (the
 * same keypair `m2m.ts` uses), distinguished by a fixed `kid` of
 * `auth-proxy:pat:1`. Payload: sub/org_id/email (caller identity at
 * issuance time), jti (PAT id, used as the revocation lookup key),
 * iat, optional exp.
 *
 * Dev-mode parity: when `AUTH_MODE=dev`, the PAT id (and therefore the
 * `jti` claim) is prefixed `dev-pat-` instead of `pat_`. The token is
 * still an RS256 JWT validated through the same dispatch, so the
 * verification path is identical to production — the prefix only
 * exists to make dev-issued tokens visually distinguishable so they
 * can't be confused with prod credentials.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  decodeProtectedHeader,
  generateKeyPair,
  type JWTPayload,
  jwtVerify,
  SignJWT,
} from "jose";

const PAT_KID = "auth-proxy:pat:1";

const PAT_ID_PREFIX_PROD = "pat_";
const PAT_ID_PREFIX_DEV = "dev-pat-";

function patIdPrefix(): string {
  return process.env.AUTH_MODE === "dev"
    ? PAT_ID_PREFIX_DEV
    : PAT_ID_PREFIX_PROD;
}

export interface PatOwner {
  sub: string;
  orgId: string;
  email: string;
}

export interface PatRecord {
  id: string;
  userId: string;
  orgId: string;
  email: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface RuntimeConfig {
  issuer: string;
  audience: string;
  storePath: string | null;
}

function readConfig(): RuntimeConfig {
  return {
    issuer: process.env.M2M_ISSUER || "auth-proxy",
    audience:
      process.env.M2M_AUDIENCE ||
      (process.env.AUTH_MODE === "dev"
        ? "dev-client"
        : process.env.WORKOS_CLIENT_ID || ""),
    storePath: process.env.PAT_STORE_PATH || null,
  };
}

const records = new Map<string, PatRecord>();
let storeLoadedFor: string | null = null;

function loadFromDiskIfNeeded(): void {
  const { storePath } = readConfig();
  if (!storePath) return;
  if (storeLoadedFor === storePath) return;

  records.clear();
  storeLoadedFor = storePath;

  if (!existsSync(storePath)) return;

  // JSONL: one PatRecord-or-tombstone per line. A tombstone with
  // {op: "revoke", id} marks an existing record revoked. Last write wins
  // for a given id, which lets us replay the file on boot without
  // needing transactional rewrite.
  const raw = readFileSync(storePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as
        | (PatRecord & { op?: undefined })
        | { op: "revoke"; id: string; revokedAt: string };
      if ("op" in entry && entry.op === "revoke") {
        const existing = records.get(entry.id);
        if (existing) {
          existing.revokedAt = entry.revokedAt;
        }
      } else {
        records.set(entry.id, entry as PatRecord);
      }
    } catch {
      // Skip unparseable lines rather than failing boot.
    }
  }
}

function persist(line: object): void {
  const { storePath } = readConfig();
  if (!storePath) return;
  const dir = dirname(storePath);
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(storePath, JSON.stringify(line) + "\n", "utf8");
}

let keypairPromise: ReturnType<typeof generateKeyPair> | null = null;

function getKeypair() {
  if (!keypairPromise) {
    keypairPromise = generateKeyPair("RS256");
  }
  return keypairPromise;
}

export function getPatKid(): string {
  return PAT_KID;
}

export function isPatToken(token: string): boolean {
  if (!token || typeof token !== "string") return false;
  try {
    return decodeProtectedHeader(token).kid === PAT_KID;
  } catch {
    return false;
  }
}

export interface IssueOptions {
  name: string;
  expiresInSeconds?: number | null;
}

export interface IssuedPat {
  record: PatRecord;
  token: string;
}

export async function issuePat(
  owner: PatOwner,
  opts: IssueOptions,
): Promise<IssuedPat> {
  loadFromDiskIfNeeded();

  const id = `${patIdPrefix()}${randomUUID().replace(/-/g, "")}`;
  const now = new Date();
  const expiresAt =
    opts.expiresInSeconds && opts.expiresInSeconds > 0
      ? new Date(now.getTime() + opts.expiresInSeconds * 1000)
      : null;

  const record: PatRecord = {
    id,
    userId: owner.sub,
    orgId: owner.orgId,
    email: owner.email,
    name: opts.name,
    createdAt: now.toISOString(),
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    revokedAt: null,
  };

  records.set(id, record);
  persist(record);

  const { privateKey } = await getKeypair();
  const { issuer, audience } = readConfig();

  const builder = new SignJWT({
    org_id: owner.orgId,
    email: owner.email,
  })
    .setProtectedHeader({ alg: "RS256", kid: PAT_KID })
    .setSubject(owner.sub)
    .setJti(id)
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(Math.floor(now.getTime() / 1000));

  if (expiresAt) {
    builder.setExpirationTime(Math.floor(expiresAt.getTime() / 1000));
  }

  const token = await builder.sign(privateKey);

  return { record, token };
}

export async function verifyPatToken(token: string): Promise<JWTPayload> {
  loadFromDiskIfNeeded();

  const { publicKey } = await getKeypair();
  const { issuer, audience } = readConfig();
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ["RS256"],
    issuer,
    audience,
  });

  const jti = payload.jti;
  if (!jti || typeof jti !== "string") {
    throw new Error("PAT missing jti claim");
  }

  const record = records.get(jti);
  if (!record) {
    throw new Error("PAT not found");
  }
  if (record.revokedAt) {
    throw new Error("PAT revoked");
  }

  return payload;
}

export function listPatsForUser(userId: string): PatRecord[] {
  loadFromDiskIfNeeded();
  const out: PatRecord[] = [];
  for (const r of records.values()) {
    if (r.userId === userId) out.push(r);
  }
  // Stable sort: most recently created first.
  out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return out;
}

/**
 * Revoke a PAT. Returns true on success, false when the PAT does not
 * exist or is already revoked, or when it does not belong to `userId`.
 * The same false return for "not yours" and "doesn't exist" is
 * intentional — we don't leak the existence of other users' PATs.
 */
export function revokePat(id: string, userId: string): boolean {
  loadFromDiskIfNeeded();
  const record = records.get(id);
  if (!record) return false;
  if (record.userId !== userId) return false;
  if (record.revokedAt) return false;
  const revokedAt = new Date().toISOString();
  record.revokedAt = revokedAt;
  persist({ op: "revoke", id, revokedAt });
  return true;
}

/**
 * Project a PatRecord into the shape returned by GET /api/auth/pats.
 * Drops nothing sensitive (records hold no token material), but kept
 * as a single point of truth so the response shape is reviewable.
 */
export function patListItem(record: PatRecord): {
  id: string;
  name: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
} {
  return {
    id: record.id,
    name: record.name,
    created_at: record.createdAt,
    expires_at: record.expiresAt,
    revoked_at: record.revokedAt,
  };
}

/** Test-only helper: clears the in-memory store and the module keypair. */
export function _resetForTests(): void {
  records.clear();
  storeLoadedFor = null;
  keypairPromise = null;
}
