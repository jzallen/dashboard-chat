import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "./auth";

function createTestApp() {
  const app = new Hono();
  app.use("*", authMiddleware);
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/protected", (c) => c.json({ data: "secret" }));
  return app;
}

describe("authMiddleware", () => {
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
