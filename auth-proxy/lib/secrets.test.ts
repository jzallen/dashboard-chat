/**
 * Unit tests for the `SecretsProvider` abstraction.
 *
 * The dc-0r0 keypair-persistence behaviour is exercised end-to-end via
 * `m2m.test.ts` and `pat-issuance.test.ts`; this file covers the
 * provider contract directly so a future provider can be added by
 * conforming to the same shape.
 */

import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  FileSecretsProvider,
  getSecretsProvider,
  NoopSecretsProvider,
  type StoredKeypair,
  VaultSecretsProvider,
} from "./secrets.ts";

const SAMPLE: StoredKeypair = {
  privateJwk: { kty: "RSA", n: "stub-n", e: "AQAB", d: "stub-d" },
  publicJwk: { kty: "RSA", n: "stub-n", e: "AQAB" },
};

const ENV_KEYS = [
  "AUTH_PROXY_SECRETS_PROVIDER",
  "AUTH_PROXY_KEYPAIR_PATH",
  "VAULT_ADDR",
  "VAULT_TOKEN",
  "VAULT_KEYPAIR_PATH",
];

const ORIG_ENV = { ...process.env };

function resetEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
  for (const k of ENV_KEYS) {
    const v = ORIG_ENV[k];
    if (v !== undefined) process.env[k] = v;
  }
  // Tests below explicitly delete keys before reading env; the snapshot
  // here just guarantees we don't bleed state across files.
  for (const k of ENV_KEYS) delete process.env[k];
}

beforeEach(resetEnv);
afterEach(resetEnv);

describe("FileSecretsProvider", () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "secrets-file-"));
    path = join(dir, "keypair.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when the file does not exist", async () => {
    const provider = new FileSecretsProvider(path);
    expect(await provider.loadKeypair()).toBeNull();
  });

  it("round-trips a keypair through saveKeypair → loadKeypair", async () => {
    const provider = new FileSecretsProvider(path);
    await provider.saveKeypair(SAMPLE);

    const loaded = await provider.loadKeypair();
    expect(loaded).toEqual(SAMPLE);
  });

  it("writes the file with mode 0600", async () => {
    const provider = new FileSecretsProvider(path);
    await provider.saveKeypair(SAMPLE);

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("creates the parent directory when it does not exist", async () => {
    const nested = join(dir, "nested", "subdir", "keypair.json");
    const provider = new FileSecretsProvider(nested);
    await provider.saveKeypair(SAMPLE);

    expect(existsSync(nested)).toBe(true);
    const loaded = await provider.loadKeypair();
    expect(loaded).toEqual(SAMPLE);
  });

  it("returns null on a corrupt file rather than throwing", async () => {
    writeFileSync(path, "{not valid json", "utf8");
    chmodSync(path, 0o600);
    const provider = new FileSecretsProvider(path);
    expect(await provider.loadKeypair()).toBeNull();
  });

  it("returns null when the file is missing required JWK fields", async () => {
    writeFileSync(path, JSON.stringify({ privateJwk: SAMPLE.privateJwk }), "utf8");
    const provider = new FileSecretsProvider(path);
    expect(await provider.loadKeypair()).toBeNull();
  });

  it("overwrites the existing file on subsequent saves (atomic rename)", async () => {
    const provider = new FileSecretsProvider(path);
    await provider.saveKeypair(SAMPLE);

    const next: StoredKeypair = {
      privateJwk: { kty: "RSA", n: "next-n", e: "AQAB", d: "next-d" },
      publicJwk: { kty: "RSA", n: "next-n", e: "AQAB" },
    };
    await provider.saveKeypair(next);

    const fileText = readFileSync(path, "utf8");
    expect(JSON.parse(fileText)).toEqual(next);
  });
});

describe("VaultSecretsProvider", () => {
  it("requires addr / token / path", () => {
    expect(
      () =>
        new VaultSecretsProvider({
          addr: "",
          token: "t",
          path: "secret/data/x",
        }),
    ).toThrow(/addr/);
    expect(
      () =>
        new VaultSecretsProvider({
          addr: "https://vault",
          token: "",
          path: "secret/data/x",
        }),
    ).toThrow(/token/);
    expect(
      () =>
        new VaultSecretsProvider({
          addr: "https://vault",
          token: "t",
          path: "",
        }),
    ).toThrow(/path/);
  });

  it("returns null on a 404 (path not yet written)", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("", { status: 404 });
    const provider = new VaultSecretsProvider({
      addr: "https://vault.example",
      token: "t",
      path: "secret/data/auth-proxy/keypair",
      fetchImpl,
    });

    expect(await provider.loadKeypair()).toBeNull();
  });

  it("reads kv-v2 shape: response.data.data is the stored JWK pair", async () => {
    const fetchImpl: typeof fetch = async (url, init) => {
      expect(String(url)).toBe(
        "https://vault.example/v1/secret/data/auth-proxy/keypair",
      );
      expect(init?.method).toBe("GET");
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.["X-Vault-Token"]).toBe("t");
      return new Response(
        JSON.stringify({ data: { data: SAMPLE } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };
    const provider = new VaultSecretsProvider({
      addr: "https://vault.example",
      token: "t",
      path: "secret/data/auth-proxy/keypair",
      fetchImpl,
    });

    expect(await provider.loadKeypair()).toEqual(SAMPLE);
  });

  it("writes via POST with kv-v2 envelope: { data: <stored> }", async () => {
    let captured: { url: string; method?: string; body?: string } | null = null;
    const fetchImpl: typeof fetch = async (url, init) => {
      captured = {
        url: String(url),
        method: init?.method,
        body: typeof init?.body === "string" ? init.body : "",
      };
      return new Response("{}", { status: 200 });
    };
    const provider = new VaultSecretsProvider({
      addr: "https://vault.example/",
      token: "t",
      path: "/secret/data/auth-proxy/keypair",
      fetchImpl,
    });

    await provider.saveKeypair(SAMPLE);

    expect(captured).not.toBeNull();
    expect(captured!.url).toBe(
      "https://vault.example/v1/secret/data/auth-proxy/keypair",
    );
    expect(captured!.method).toBe("POST");
    expect(JSON.parse(captured!.body!)).toEqual({ data: SAMPLE });
  });

  it("throws on a non-2xx, non-404 response (load)", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("forbidden", { status: 403, statusText: "Forbidden" });
    const provider = new VaultSecretsProvider({
      addr: "https://vault.example",
      token: "t",
      path: "secret/data/auth-proxy/keypair",
      fetchImpl,
    });

    await expect(provider.loadKeypair()).rejects.toThrow(/Vault read failed.*403/);
  });

  it("throws on a non-2xx response (save)", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("denied", { status: 403, statusText: "Forbidden" });
    const provider = new VaultSecretsProvider({
      addr: "https://vault.example",
      token: "t",
      path: "secret/data/auth-proxy/keypair",
      fetchImpl,
    });

    await expect(provider.saveKeypair(SAMPLE)).rejects.toThrow(
      /Vault write failed.*403/,
    );
  });
});

describe("getSecretsProvider — env resolution", () => {
  it("returns NoopSecretsProvider when no env is set", () => {
    expect(getSecretsProvider()).toBeInstanceOf(NoopSecretsProvider);
  });

  it("returns FileSecretsProvider when AUTH_PROXY_KEYPAIR_PATH is set (legacy contract)", () => {
    process.env.AUTH_PROXY_KEYPAIR_PATH = "/tmp/dc-0r0-keypair.json";
    expect(getSecretsProvider()).toBeInstanceOf(FileSecretsProvider);
  });

  it("AUTH_PROXY_SECRETS_PROVIDER=file requires AUTH_PROXY_KEYPAIR_PATH", () => {
    process.env.AUTH_PROXY_SECRETS_PROVIDER = "file";
    expect(() => getSecretsProvider()).toThrow(/AUTH_PROXY_KEYPAIR_PATH/);
  });

  it("AUTH_PROXY_SECRETS_PROVIDER=vault requires VAULT_ADDR / VAULT_TOKEN / VAULT_KEYPAIR_PATH", () => {
    process.env.AUTH_PROXY_SECRETS_PROVIDER = "vault";
    expect(() => getSecretsProvider()).toThrow(/VAULT_ADDR/);

    process.env.VAULT_ADDR = "https://vault.example";
    expect(() => getSecretsProvider()).toThrow(/VAULT_TOKEN/);

    process.env.VAULT_TOKEN = "t";
    expect(() => getSecretsProvider()).toThrow(/VAULT_KEYPAIR_PATH/);

    process.env.VAULT_KEYPAIR_PATH = "secret/data/auth-proxy/keypair";
    expect(getSecretsProvider()).toBeInstanceOf(VaultSecretsProvider);
  });

  it("rejects an unknown selector", () => {
    process.env.AUTH_PROXY_SECRETS_PROVIDER = "k8s";
    expect(() => getSecretsProvider()).toThrow(/Unknown AUTH_PROXY_SECRETS_PROVIDER/);
  });

  it("AUTH_PROXY_SECRETS_PROVIDER=vault overrides a present AUTH_PROXY_KEYPAIR_PATH", () => {
    process.env.AUTH_PROXY_SECRETS_PROVIDER = "vault";
    process.env.AUTH_PROXY_KEYPAIR_PATH = "/tmp/should-be-ignored";
    process.env.VAULT_ADDR = "https://vault.example";
    process.env.VAULT_TOKEN = "t";
    process.env.VAULT_KEYPAIR_PATH = "secret/data/auth-proxy/keypair";

    expect(getSecretsProvider()).toBeInstanceOf(VaultSecretsProvider);
  });
});
