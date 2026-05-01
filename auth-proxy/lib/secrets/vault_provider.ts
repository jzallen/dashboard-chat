/**
 * HashiCorp Vault kv-v2 `SecretsProvider`.
 *
 * Reads/writes the JWK pair at `VAULT_KEYPAIR_PATH` via Vault's
 * HTTP API. Uses `node:fetch` (no Vault SDK dependency) so the
 * runtime stays small and the surface is the same the operator can
 * curl. The provider expects the kv-v2 mount; the path is the
 * full data path including the mount prefix and `data/` segment,
 * e.g. `secret/data/auth-proxy/keypair`.
 *
 * Security: `VAULT_TOKEN` is read from env at boot. Rotating the
 * Vault token requires restarting auth-proxy. This is intentional —
 * we do not want auth-proxy to re-read the env in the steady state.
 *
 * Failure model: any non-2xx (other than the documented 404 on
 * "not found") throws. A misconfigured Vault must crash the
 * process at boot; silently falling back to a fresh keypair would
 * invalidate every previously-issued token.
 */

import type { SecretsProvider, StoredKeypair } from "../secrets.ts";

export interface VaultProviderOptions {
  addr: string;
  token: string;
  path: string;
  fetchImpl?: typeof fetch;
}

interface VaultReadResponse {
  data?: {
    data?: StoredKeypair;
  };
}

export class VaultSecretsProvider implements SecretsProvider {
  private readonly addr: string;
  private readonly token: string;
  private readonly path: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: VaultProviderOptions) {
    if (!opts.addr) throw new Error("VaultSecretsProvider: addr is required");
    if (!opts.token) throw new Error("VaultSecretsProvider: token is required");
    if (!opts.path) throw new Error("VaultSecretsProvider: path is required");
    this.addr = opts.addr.replace(/\/+$/, "");
    this.token = opts.token;
    this.path = opts.path.replace(/^\/+/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  static fromEnv(): VaultSecretsProvider {
    const addr = process.env.VAULT_ADDR;
    const token = process.env.VAULT_TOKEN;
    const path = process.env.VAULT_KEYPAIR_PATH;
    if (!addr) {
      throw new Error(
        "AUTH_PROXY_SECRETS_PROVIDER=vault requires VAULT_ADDR to be set",
      );
    }
    if (!token) {
      throw new Error(
        "AUTH_PROXY_SECRETS_PROVIDER=vault requires VAULT_TOKEN to be set",
      );
    }
    if (!path) {
      throw new Error(
        "AUTH_PROXY_SECRETS_PROVIDER=vault requires VAULT_KEYPAIR_PATH to be set",
      );
    }
    return new VaultSecretsProvider({ addr, token, path });
  }

  private url(): string {
    return `${this.addr}/v1/${this.path}`;
  }

  private headers(): Record<string, string> {
    return {
      "X-Vault-Token": this.token,
      "Content-Type": "application/json",
    };
  }

  async loadKeypair(): Promise<StoredKeypair | null> {
    const res = await this.fetchImpl(this.url(), {
      method: "GET",
      headers: this.headers(),
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await safeBody(res);
      throw new Error(
        `Vault read failed: ${res.status} ${res.statusText} ${body}`,
      );
    }

    const json = (await res.json()) as VaultReadResponse;
    const data = json?.data?.data;
    if (!data?.privateJwk || !data?.publicJwk) return null;
    return { privateJwk: data.privateJwk, publicJwk: data.publicJwk };
  }

  async saveKeypair(stored: StoredKeypair): Promise<void> {
    const res = await this.fetchImpl(this.url(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ data: stored }),
    });

    if (!res.ok) {
      const body = await safeBody(res);
      throw new Error(
        `Vault write failed: ${res.status} ${res.statusText} ${body}`,
      );
    }
  }
}

async function safeBody(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
