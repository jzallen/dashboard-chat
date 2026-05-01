/**
 * File-backed `SecretsProvider`.
 *
 * Preserves the dc-0r0 contract: read/write a JSON file at
 * `AUTH_PROXY_KEYPAIR_PATH`, atomic write + mode 0600. Suitable for
 * single-replica deployments where the file lives on a mounted
 * secret-grade volume. Multi-replica deployments must use a remote
 * provider (`VaultSecretsProvider`) — a shared file mount works in
 * compose for the acceptance test, but is not the production target.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import type { SecretsProvider, StoredKeypair } from "../secrets.ts";

export class FileSecretsProvider implements SecretsProvider {
  constructor(private readonly path: string) {}

  async loadKeypair(): Promise<StoredKeypair | null> {
    if (!existsSync(this.path)) return null;
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as StoredKeypair;
      if (!parsed?.privateJwk || !parsed?.publicJwk) return null;
      return parsed;
    } catch {
      // Corrupt/unreadable persisted keypair: surface as "not present" so
      // the caller regenerates and overwrites. A corrupt file would
      // otherwise wedge auth-proxy entirely; rotating is a less-bad
      // failure mode than a hard crash.
      return null;
    }
  }

  async saveKeypair(stored: StoredKeypair): Promise<void> {
    const dir = dirname(this.path);
    if (dir && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Atomic write: a concurrent reader either sees the old file or
    // the new file, never a half-written one. Mode 0600 keeps the
    // private key off other unix users on the host.
    const tmp = `${this.path}.tmp.${process.pid}`;
    writeFileSync(tmp, JSON.stringify(stored), {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(tmp, this.path);
  }
}
