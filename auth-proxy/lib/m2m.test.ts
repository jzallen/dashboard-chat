import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  _resetForTests,
  authenticateClient,
  DEV_CLIENT_ID,
  DEV_CLIENT_SECRET,
  isM2mEnabled,
  isM2mToken,
  issueM2mToken,
  verifyM2mToken,
} from "./m2m.ts";

const ORIG_ENV = { ...process.env };

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith("M2M_") ||
      key === "AUTH_MODE" ||
      key === "WORKOS_CLIENT_ID"
    ) {
      delete process.env[key];
    }
  }
  for (const [k, v] of Object.entries(ORIG_ENV)) {
    if (
      k.startsWith("M2M_") ||
      k === "AUTH_MODE" ||
      k === "WORKOS_CLIENT_ID"
    ) {
      if (v !== undefined) process.env[k] = v;
    }
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

describe("isM2mEnabled", () => {
  it("returns false when M2M_ENABLED is unset", () => {
    delete process.env.M2M_ENABLED;
    expect(isM2mEnabled()).toBe(false);
  });

  it("returns false when M2M_ENABLED is false", () => {
    process.env.M2M_ENABLED = "false";
    expect(isM2mEnabled()).toBe(false);
  });

  it("returns true when M2M_ENABLED is true", () => {
    process.env.M2M_ENABLED = "true";
    expect(isM2mEnabled()).toBe(true);
  });

  it("is case-insensitive on the flag value", () => {
    process.env.M2M_ENABLED = "TRUE";
    expect(isM2mEnabled()).toBe(true);
  });
});

describe("authenticateClient", () => {
  beforeEach(() => {
    process.env.M2M_CLIENTS = JSON.stringify({
      "svc-1": {
        secret: "topsecret",
        sub: "service-account:svc-1",
        org_id: "org-1",
        email: "svc-1@example.com",
      },
      "svc-2": {
        secret: "another-secret",
        sub: "service-account:svc-2",
        org_id: "org-2",
        email: "svc-2@example.com",
      },
    });
  });

  it("returns client identity for valid credentials", async () => {
    const client = await authenticateClient("svc-1", "topsecret");
    expect(client).toEqual({
      sub: "service-account:svc-1",
      orgId: "org-1",
      email: "svc-1@example.com",
    });
  });

  it("returns null for invalid secret", async () => {
    const client = await authenticateClient("svc-1", "wrong-secret");
    expect(client).toBeNull();
  });

  it("returns null for unknown client_id", async () => {
    const client = await authenticateClient("unknown", "topsecret");
    expect(client).toBeNull();
  });

  it("returns null when secrets differ in length (no length leak)", async () => {
    const client = await authenticateClient("svc-1", "short");
    expect(client).toBeNull();
  });

  it("returns null when M2M_CLIENTS env is unset", async () => {
    delete process.env.M2M_CLIENTS;
    const client = await authenticateClient("svc-1", "topsecret");
    expect(client).toBeNull();
  });

  it("returns null when M2M_CLIENTS is malformed JSON", async () => {
    process.env.M2M_CLIENTS = "{not valid json";
    const client = await authenticateClient("svc-1", "topsecret");
    expect(client).toBeNull();
  });
});

describe("authenticateClient — dev-mode parity", () => {
  it("authenticates the built-in dev client when AUTH_MODE=dev with no M2M_CLIENTS", async () => {
    process.env.AUTH_MODE = "dev";
    delete process.env.M2M_CLIENTS;

    const client = await authenticateClient(DEV_CLIENT_ID, DEV_CLIENT_SECRET);
    expect(client).toEqual({
      sub: "dev-user-001",
      orgId: "dev-org-001",
      email: "dev@localhost",
    });
  });

  it("rejects the built-in dev client outside dev mode", async () => {
    process.env.AUTH_MODE = "workos";
    delete process.env.M2M_CLIENTS;

    const client = await authenticateClient(DEV_CLIENT_ID, DEV_CLIENT_SECRET);
    expect(client).toBeNull();
  });

  it("rejects an empty AUTH_MODE built-in (production default unsets dev client)", async () => {
    delete process.env.AUTH_MODE;
    delete process.env.M2M_CLIENTS;

    const client = await authenticateClient(DEV_CLIENT_ID, DEV_CLIENT_SECRET);
    expect(client).toBeNull();
  });

  it("rejects a wrong secret on the built-in dev client", async () => {
    process.env.AUTH_MODE = "dev";
    delete process.env.M2M_CLIENTS;

    const client = await authenticateClient(DEV_CLIENT_ID, "not-the-secret");
    expect(client).toBeNull();
  });

  it("merges built-in dev client with user-supplied M2M_CLIENTS in dev mode", async () => {
    process.env.AUTH_MODE = "dev";
    process.env.M2M_CLIENTS = JSON.stringify({
      "extra-svc": {
        secret: "extra-secret",
        sub: "service-account:extra",
        org_id: "org-extra",
        email: "extra@example.com",
      },
    });

    const dev = await authenticateClient(DEV_CLIENT_ID, DEV_CLIENT_SECRET);
    expect(dev?.sub).toBe("dev-user-001");

    const extra = await authenticateClient("extra-svc", "extra-secret");
    expect(extra?.sub).toBe("service-account:extra");
  });

  it("user-supplied M2M_CLIENTS entry overrides built-in dev client when ids collide", async () => {
    process.env.AUTH_MODE = "dev";
    process.env.M2M_CLIENTS = JSON.stringify({
      [DEV_CLIENT_ID]: {
        secret: "override-secret",
        sub: "override-sub",
        org_id: "override-org",
        email: "override@example.com",
      },
    });

    // Built-in secret no longer works
    const builtin = await authenticateClient(DEV_CLIENT_ID, DEV_CLIENT_SECRET);
    expect(builtin).toBeNull();

    // Override secret + override identity is what authenticates
    const overridden = await authenticateClient(DEV_CLIENT_ID, "override-secret");
    expect(overridden).toEqual({
      sub: "override-sub",
      orgId: "override-org",
      email: "override@example.com",
    });
  });
});

describe("issueM2mToken / verifyM2mToken round trip", () => {
  beforeEach(() => {
    process.env.AUTH_MODE = "dev";
  });

  it("issues a JWT that verifies with the same keypair", async () => {
    const { token, expiresIn } = await issueM2mToken({
      sub: "service-account:svc-a",
      orgId: "org-a",
      email: "svc-a@example.com",
    });
    expect(typeof token).toBe("string");
    expect(token.split(".")).toHaveLength(3);
    expect(expiresIn).toBeGreaterThan(0);

    const payload = await verifyM2mToken(token);
    expect(payload.sub).toBe("service-account:svc-a");
    expect(payload.org_id).toBe("org-a");
    expect(payload.email).toBe("svc-a@example.com");
  });

  it("issues a JWT recognised by isM2mToken via kid header", async () => {
    const { token } = await issueM2mToken({
      sub: "x",
      orgId: "y",
      email: "z@example.com",
    });
    expect(isM2mToken(token)).toBe(true);
  });

  it("isM2mToken returns false for tokens without the M2M kid", () => {
    // A non-M2M token: header { alg: 'RS256' } base64url, body {}, fake sig
    const header = Buffer.from(JSON.stringify({ alg: "RS256" }))
      .toString("base64url");
    const body = Buffer.from(JSON.stringify({ sub: "x" }))
      .toString("base64url");
    const fake = `${header}.${body}.signature`;
    expect(isM2mToken(fake)).toBe(false);
  });

  it("isM2mToken returns false for non-JWT strings", () => {
    expect(isM2mToken("not-a-jwt")).toBe(false);
    expect(isM2mToken("")).toBe(false);
  });

  it("verifyM2mToken honours TTL (expired token rejected)", async () => {
    process.env.M2M_TOKEN_TTL_SECONDS = "1";
    const { token } = await issueM2mToken({
      sub: "x",
      orgId: "y",
      email: "z@example.com",
    });
    // Sleep just over TTL
    await new Promise((r) => setTimeout(r, 1100));
    await expect(verifyM2mToken(token)).rejects.toThrow();
  });

  it("verifyM2mToken rejects tokens signed with a different keypair", async () => {
    const { token } = await issueM2mToken({
      sub: "x",
      orgId: "y",
      email: "z@example.com",
    });
    // Reset rotates the keypair; verification with the new keypair should fail
    _resetForTests();
    await expect(verifyM2mToken(token)).rejects.toThrow();
  });
});
