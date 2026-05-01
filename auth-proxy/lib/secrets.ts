/**
 * Pluggable persistence for the auth-proxy RS256 keypair.
 *
 * Why this exists: a single auth-proxy replica with a mounted keypair
 * file is fine, but as soon as you scale to N replicas the file-based
 * default no longer holds — different pods/containers generate
 * different keys, and a token issued by replica A fails at replica B.
 * `SecretsProvider` is the seam: a small interface with a file-backed
 * default (the existing AUTH_PROXY_KEYPAIR_PATH behaviour, exactly
 * preserved) and a remote implementation (HashiCorp Vault kv-v2) for
 * deployments where multiple replicas must share the same key.
 *
 * Selection: `AUTH_PROXY_SECRETS_PROVIDER=file|vault` picks the impl.
 * Unset means "honour the legacy contract" — file provider iff
 * AUTH_PROXY_KEYPAIR_PATH is set, otherwise no persistence (boot-time
 * keypair only, the dev/test default).
 *
 * Why Vault as the remote choice: it is the deployment-agnostic option
 * (cloud-portable, on-prem-friendly, has a stable HTTP contract).
 * Operators wiring AWS Secrets Manager or k8s Secrets can drop in a
 * sibling provider — `getSecretsProvider()` is the single point that
 * needs extending.
 */

import type { JWK } from "jose";

export interface StoredKeypair {
  privateJwk: JWK;
  publicJwk: JWK;
}

export interface SecretsProvider {
  /**
   * Load the persisted keypair. Returns null when no keypair is
   * stored yet (a fresh deployment) — the caller will generate one
   * and call `saveKeypair`. Throws on transport errors so a
   * misconfigured remote provider fails loud at boot rather than
   * silently regenerating and rotating tokens.
   */
  loadKeypair(): Promise<StoredKeypair | null>;

  /**
   * Persist the keypair. Idempotent — subsequent boots see the same
   * key material on the next `loadKeypair`.
   */
  saveKeypair(stored: StoredKeypair): Promise<void>;
}

export class NoopSecretsProvider implements SecretsProvider {
  async loadKeypair(): Promise<StoredKeypair | null> {
    return null;
  }
  async saveKeypair(_stored: StoredKeypair): Promise<void> {
    // No persistence — the keypair lives only in process memory.
  }
}

/** True iff this provider actually persists across process boundaries. */
export function isPersistent(provider: SecretsProvider): boolean {
  return !(provider instanceof NoopSecretsProvider);
}

export { FileSecretsProvider } from "./secrets/file_provider.ts";
export { VaultSecretsProvider } from "./secrets/vault_provider.ts";

import { FileSecretsProvider } from "./secrets/file_provider.ts";
import { VaultSecretsProvider } from "./secrets/vault_provider.ts";

/**
 * Resolve the configured `SecretsProvider` from environment.
 *
 * Resolution rules (read in order, first match wins):
 *
 *   1. `AUTH_PROXY_SECRETS_PROVIDER=vault` → `VaultSecretsProvider`
 *      reading `VAULT_ADDR` / `VAULT_TOKEN` / `VAULT_KEYPAIR_PATH`.
 *      Missing required env throws synchronously — a misconfigured
 *      remote provider must crash at boot, not silently fall through
 *      to a fresh keypair (which would invalidate existing tokens).
 *
 *   2. `AUTH_PROXY_SECRETS_PROVIDER=file` → `FileSecretsProvider`
 *      reading `AUTH_PROXY_KEYPAIR_PATH` (required).
 *
 *   3. Unset selector + `AUTH_PROXY_KEYPAIR_PATH` set → file provider
 *      (the legacy/dc-0r0 contract — single-replica, file-mounted).
 *
 *   4. Otherwise → `NoopSecretsProvider`. Suitable for tests and
 *      ephemeral dev where token longevity is not promised.
 */
export function getSecretsProvider(): SecretsProvider {
  const selector = (process.env.AUTH_PROXY_SECRETS_PROVIDER || "")
    .trim()
    .toLowerCase();

  if (selector === "vault") {
    return VaultSecretsProvider.fromEnv();
  }

  if (selector === "file") {
    const path = process.env.AUTH_PROXY_KEYPAIR_PATH;
    if (!path) {
      throw new Error(
        "AUTH_PROXY_SECRETS_PROVIDER=file requires AUTH_PROXY_KEYPAIR_PATH to be set",
      );
    }
    return new FileSecretsProvider(path);
  }

  if (selector && selector !== "file" && selector !== "vault") {
    throw new Error(
      `Unknown AUTH_PROXY_SECRETS_PROVIDER=${JSON.stringify(selector)} ` +
        `(expected one of: file, vault)`,
    );
  }

  // Selector unset: honour the legacy contract.
  const path = process.env.AUTH_PROXY_KEYPAIR_PATH;
  if (path) return new FileSecretsProvider(path);
  return new NoopSecretsProvider();
}
