import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";

// Shared mock state that tests configure before importing auth module
let mockJwtVerifyImpl: (...args: any[]) => any = vi.fn();

vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
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

  it("rejects request with invalid token", async () => {
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/invalid/i);
  });

  it("accepts request with valid dev token", async () => {
    const res = await app.request("/protected", {
      headers: { Authorization: "Bearer dev-token-static" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: "secret" });
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
