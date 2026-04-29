/**
 * Shared RS256 keypair for auth-proxy-issued tokens (M2M + PAT).
 *
 * Generates a single in-process keypair on first use; both M2M tokens
 * (`kid=auth-proxy:m2m:1`) and PATs (`kid=auth-proxy:pat:1`) sign and
 * verify against it.
 *
 * Persistence: when `AUTH_PROXY_KEYPAIR_PATH` is set, the keypair is
 * serialized to that path as JWK JSON and re-loaded on the next boot.
 * Without persistence, every restart rotates the keypair — which
 * silently invalidates every previously-issued PAT and every M2M token
 * still inside its TTL window. PATs in particular are advertised as
 * long-lived (see `pat.ts` header), so production deployments must
 * configure persistence to honour that contract.
 *
 * File format: `{"privateJwk": {...}, "publicJwk": {...}}`. Written
 * atomically (write-temp-then-rename) with mode 0600 so private key
 * material is not world-readable.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import {
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
} from "jose";

interface Keypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

interface StoredKeypair {
  privateJwk: JWK;
  publicJwk: JWK;
}

let keypairPromise: Promise<Keypair> | null = null;
let loadedFor: string | null = null;

function readPath(): string | null {
  return process.env.AUTH_PROXY_KEYPAIR_PATH || null;
}

/**
 * Returns the shared RS256 keypair, generating it on first call. When
 * `AUTH_PROXY_KEYPAIR_PATH` is set, the keypair is loaded from disk if
 * the file exists, or generated and persisted otherwise. The cached
 * promise is invalidated when the env var changes between calls so
 * tests that toggle persistence pick up the new path.
 */
export function getKeypair(): Promise<Keypair> {
  const path = readPath();
  if (keypairPromise && loadedFor !== path) {
    keypairPromise = null;
  }
  if (!keypairPromise) {
    loadedFor = path;
    keypairPromise = loadOrGenerate(path);
  }
  return keypairPromise;
}

async function loadOrGenerate(path: string | null): Promise<Keypair> {
  if (path && existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf8");
      const stored = JSON.parse(raw) as StoredKeypair;
      const privateKey = (await importJWK(
        stored.privateJwk,
        "RS256",
      )) as CryptoKey;
      const publicKey = (await importJWK(
        stored.publicJwk,
        "RS256",
      )) as CryptoKey;
      return { privateKey, publicKey };
    } catch {
      // Corrupt/unreadable persisted keypair: fall through to regenerate
      // and overwrite. A corrupt file would otherwise wedge auth-proxy
      // entirely; rotating is a less-bad failure mode than a hard crash.
    }
  }

  // `extractable: true` only when persistence is configured — without
  // it the key cannot be exported to JWK. When persistence is not
  // configured the default (non-extractable) is preserved so the key
  // material cannot leak via `exportJWK` on a non-persisted deployment.
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: path !== null,
  });

  if (path) {
    const dir = dirname(path);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const stored: StoredKeypair = {
      privateJwk: await exportJWK(privateKey),
      publicJwk: await exportJWK(publicKey),
    };
    // Atomic write: a concurrent reader either sees the old file or the
    // new file, never a half-written one. Mode 0600 keeps the private
    // key off other unix users on the host.
    const tmp = `${path}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(stored), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmp, path);
  }

  return { privateKey, publicKey };
}

/** Test-only helper: drops the cached keypair so the next call regenerates or reloads. */
export function _resetKeypairForTests(): void {
  keypairPromise = null;
  loadedFor = null;
}
