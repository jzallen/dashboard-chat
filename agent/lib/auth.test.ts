import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Shared mock state that tests configure before importing auth module
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock needs flexible signature
let mockJwtVerifyImpl: (...args: any[]) => any = vi.fn();

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock needs flexible signature
  jwtVerify: vi.fn((...args: any[]) => mockJwtVerifyImpl(...args)),
}));

import { authMiddleware } from "./auth";

function createTestApp() {
  const app = new Hono();
  app.use("*", authMiddleware);
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/protected", (c) => c.json({ data: "secret" }));
  return app;
}

describe("authMiddleware (dev mode)", () => {
  beforeEach(() => {
    mockJwtVerifyImpl = vi.fn().mockResolvedValue({
      payload: {
        sub: "dev-user-001",
        org_id: "dev-org-001",
        email: "dev@localhost",
      },
      protectedHeader: { alg: "RS256" },
      key: {},
    });
  });

  const app = createTestApp();

  it("allows /health without a token", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("rejects request without Authorization header", async () => {
    const res = await app.request("/protected");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/Authorization/i);
  });

  it("rejects request with invalid JWT", async () => {
    mockJwtVerifyImpl = vi.fn().mockRejectedValue(new Error("Invalid JWT"));
    const freshApp = createTestApp();
    const res = await freshApp.request("/protected", {
      headers: { Authorization: "Bearer invalid.jwt.token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid|expired/i);
  });

  it("accepts request with valid JWT", async () => {
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer valid.jwt.token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "secret" });
  });

  it("verifies JWT with dev audience and issuer", async () => {
    const app = createTestApp();
    await app.request("/protected", {
      headers: { Authorization: "Bearer valid.jwt.token" },
    });
    expect(mockJwtVerifyImpl).toHaveBeenCalledWith(
      "valid.jwt.token",
      expect.any(Function),
      expect.objectContaining({
        audience: "dev-client",
        issuer: "http://localhost:8000",
        algorithms: ["RS256"],
      })
    );
  });
});

describe("authMiddleware identity injection (D-MR4-05)", () => {
  // The agent must not trust that auth-proxy is in front of it for /chat
  // (the production path FE → reverse-proxy → /worker/chat → agent has no
  // auth-proxy in the chain). Identity MUST be derived from the
  // cryptographically verified JWT and reach downstream readers through
  // c.req.raw.headers — the exact channel agent/lib/chat/scope.ts uses via
  // index.ts `handleChat(c.req.raw)`.
  beforeEach(() => {
    mockJwtVerifyImpl = vi.fn().mockResolvedValue({
      payload: {
        sub: "dev-user-001",
        org_id: "dev-org-001",
        email: "dev@localhost",
      },
      protectedHeader: { alg: "RS256" },
      key: {},
    });
  });

  function appReadingRawHeaders() {
    const app = new Hono();
    app.use("*", authMiddleware);
    app.post("/echo", (c) =>
      c.json({
        orgId: c.req.raw.headers.get("x-org-id"),
        userId: c.req.raw.headers.get("x-user-id"),
      })
    );
    return app;
  }

  it("injects X-Org-Id / X-User-Id from the verified JWT onto c.req.raw", async () => {
    const app = appReadingRawHeaders();
    const res = await app.request("/echo", {
      method: "POST",
      headers: { Authorization: "Bearer valid.jwt.token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      orgId: "dev-org-001",
      userId: "dev-user-001",
    });
  });

  it("overwrites a forged inbound X-Org-Id / X-User-Id with the verified-JWT identity", async () => {
    const app = appReadingRawHeaders();
    const res = await app.request("/echo", {
      method: "POST",
      headers: {
        Authorization: "Bearer valid.jwt.token",
        "X-Org-Id": "attacker-org",
        "X-User-Id": "attacker-user",
      },
    });
    expect(res.status).toBe(200);
    // The forging client cannot escape its own tenant: JWT claims win.
    expect(await res.json()).toEqual({
      orgId: "dev-org-001",
      userId: "dev-user-001",
    });
  });
});

describe("authMiddleware (production mode)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("AUTH_MODE", "workos");
    vi.stubEnv("WORKOS_CLIENT_ID", "client_test123");
    mockJwtVerifyImpl = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function createProductionApp() {
    const { authMiddleware: freshAuth } = await import("./auth");
    const app = new Hono();
    app.use("*", freshAuth);
    app.get("/protected", (c) => c.json({ data: "secret" }));
    return app;
  }

  it("verifies JWT and allows valid token", async () => {
    mockJwtVerifyImpl = vi.fn().mockResolvedValue({
      payload: { sub: "user_123", org_id: "org_456" },
      protectedHeader: { alg: "RS256" },
      key: {},
    });

    const app = await createProductionApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer valid-jwt-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "secret" });

    expect(mockJwtVerifyImpl).toHaveBeenCalledWith(
      "valid-jwt-token",
      expect.any(Function),
      {
        audience: "client_test123",
        issuer: "https://api.workos.com/user_management/client_test123",
        algorithms: ["RS256"],
      }
    );
  });

  it("rejects request when JWT verification fails", async () => {
    mockJwtVerifyImpl = vi.fn().mockRejectedValue(new Error("JWT expired"));

    const app = await createProductionApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer expired-jwt-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid|expired/i);
  });

  it("rejects request when WORKOS_CLIENT_ID is not configured", async () => {
    vi.stubEnv("WORKOS_CLIENT_ID", "");

    const app = await createProductionApp();
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer some-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/WORKOS_CLIENT_ID/i);
  });
});
