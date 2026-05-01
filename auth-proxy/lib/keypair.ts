/**
 * Shared RS256 keypair for auth-proxy-issued tokens (M2M + PAT).
 *
 * Generates a single in-process keypair on first use; both M2M tokens
 * (`kid=auth-proxy:m2m:1`) and PATs (`kid=auth-proxy:pat:1`) sign and
 * verify against it.
 *
 * Persistence is delegated to a `SecretsProvider` (see `secrets.ts`).
 * The default in production is the file-backed provider reading
 * `AUTH_PROXY_KEYPAIR_PATH` (the legacy contract). Multi-replica
 * deployments select `AUTH_PROXY_SECRETS_PROVIDER=vault` and read
 * the same key material across replicas, so a token issued by
 * replica A verifies at replica B. Without persistence, every
 * restart rotates the keypair — which silently invalidates every
 * previously-issued PAT and every M2M token still inside its TTL
 * window. PATs are advertised as long-lived (see `pat.ts` header),
 * so production deployments must configure persistence.
 */

import {
  type CryptoKey,
  exportJWK,
  generateKeyPair,
  importJWK,
} from "jose";

import {
  getSecretsProvider,
  isPersistent,
  type SecretsProvider,
  type StoredKeypair,
} from "./secrets.ts";

interface Keypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

let keypairPromise: Promise<Keypair> | null = null;
let providerSignature: string | null = null;
let providerOverride: SecretsProvider | null = null;

/**
 * A stable identifier for the configured provider. Used to invalidate
 * the cached keypair when env switches between calls (tests toggling
 * persistence). Keys on the env vars the provider reads at construction.
 */
function currentProviderSignature(): string {
  if (providerOverride) return "<override>";
  return [
    process.env.AUTH_PROXY_SECRETS_PROVIDER || "",
    process.env.AUTH_PROXY_KEYPAIR_PATH || "",
    process.env.VAULT_ADDR || "",
    process.env.VAULT_TOKEN ? "token-set" : "",
    process.env.VAULT_KEYPAIR_PATH || "",
  ].join("|");
}

function resolveProvider(): SecretsProvider {
  return providerOverride ?? getSecretsProvider();
}

/**
 * Returns the shared RS256 keypair, generating it on first call. The
 * configured `SecretsProvider` decides whether key material is loaded
 * from / written to a backing store; `NoopSecretsProvider` (the
 * default when no persistence env is set) keeps the keypair purely
 * in process memory.
 */
export function getKeypair(): Promise<Keypair> {
  const sig = currentProviderSignature();
  if (keypairPromise && providerSignature !== sig) {
    keypairPromise = null;
  }
  if (!keypairPromise) {
    providerSignature = sig;
    keypairPromise = loadOrGenerate(resolveProvider());
  }
  return keypairPromise;
}

async function loadOrGenerate(provider: SecretsProvider): Promise<Keypair> {
  const existing = await provider.loadKeypair();
  if (existing) {
    const privateKey = (await importJWK(
      existing.privateJwk,
      "RS256",
    )) as CryptoKey;
    const publicKey = (await importJWK(
      existing.publicJwk,
      "RS256",
    )) as CryptoKey;
    return { privateKey, publicKey };
  }

  // `extractable: true` only when a persistent provider will export the
  // key — without persistence the default (non-extractable) is preserved
  // so private key material cannot leak via `exportJWK`.
  const persistent = isPersistent(provider);
  const { privateKey, publicKey } = await generateKeyPair("RS256", {
    extractable: persistent,
  });

  if (persistent) {
    const stored: StoredKeypair = {
      privateJwk: await exportJWK(privateKey),
      publicJwk: await exportJWK(publicKey),
    };
    await provider.saveKeypair(stored);
  }

  return { privateKey, publicKey };
}

/** Test-only helper: drops the cached keypair so the next call regenerates or reloads. */
export function _resetKeypairForTests(): void {
  keypairPromise = null;
  providerSignature = null;
  providerOverride = null;
}

/**
 * Test-only helper: pin a specific `SecretsProvider` instance for the
 * next `getKeypair()` call, bypassing env resolution. Useful for unit
 * tests that want to assert provider interaction directly.
 */
export function _setProviderForTests(provider: SecretsProvider | null): void {
  providerOverride = provider;
  keypairPromise = null;
  providerSignature = null;
}
