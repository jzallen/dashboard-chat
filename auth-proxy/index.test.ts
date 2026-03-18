import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock jose before importing app
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

import { jwtVerify } from "jose";

import { app } from "./app.ts";

const mockJwtVerify = vi.mocked(jwtVerify);

// Mock fetch globally for proxy tests
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeRequest(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  return app.fetch(new Request(`http://localhost${path}`, options));
}

function withAuth(token: string): RequestInit {
  return { headers: { Authorization: `Bearer ${token}` } };
}

describe("Auth Proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    // Default: JWT verification succeeds with dev user claims
    mockJwtVerify.mockResolvedValue({
      payload: {
        sub: "dev-user-001",
        org_id: "dev-org-001",
        email: "dev@localhost",
      },
      protectedHeader: { alg: "RS256" },
      key: {},
    } as never);
  });

  describe("health endpoint", () => {
    it("returns ok status", async () => {
      const res = await makeRequest("/health");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ status: "ok" });
    });

    it("does not proxy to backend", async () => {
      await makeRequest("/health");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("dev mode auth (JWKS verification)", () => {
    it("forwards request with valid JWT", async () => {
      const res = await makeRequest(
        "/api/projects",
        withAuth("valid.jwt.token")
      );
      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledOnce();
      expect(mockJwtVerify).toHaveBeenCalledWith(
        "valid.jwt.token",
        expect.any(Function),
        expect.objectContaining({
          audience: "dev-client",
          issuer: "http://localhost:8000",
          algorithms: ["RS256"],
        })
      );

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const headers = fetchOptions.headers as Headers;
      expect(headers.get("X-User-Id")).toBe("dev-user-001");
      expect(headers.get("X-Org-Id")).toBe("dev-org-001");
      expect(headers.get("X-User-Email")).toBe("dev@localhost");
    });

    it("rejects invalid JWT with 401", async () => {
      mockJwtVerify.mockRejectedValue(new Error("JWT verification failed"));
      const res = await makeRequest(
        "/api/projects",
        withAuth("invalid.jwt.token")
      );
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid or expired token");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects missing Authorization header with 401", async () => {
      const res = await makeRequest("/api/projects");
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Missing or invalid Authorization header");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("public path passthrough", () => {
    const publicPaths = [
      "/api/auth/login",
      "/api/auth/callback",
      "/api/auth/logout",
      "/api/auth/refresh",
    ];

    for (const path of publicPaths) {
      it(`forwards ${path} without authentication`, async () => {
        const res = await makeRequest(path, { method: "POST" });
        expect(res.status).toBe(200);
        expect(mockFetch).toHaveBeenCalledOnce();
      });
    }
  });

  describe("header stripping", () => {
    it("strips client-supplied identity headers before forwarding", async () => {
      const res = await makeRequest("/api/projects", {
        headers: {
          Authorization: "Bearer valid.jwt.token",
          "X-User-Id": "attacker-id",
          "X-Org-Id": "attacker-org",
          "X-User-Email": "attacker@evil.com",
        },
      });
      expect(res.status).toBe(200);

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const headers = fetchOptions.headers as Headers;
      // Should have auth proxy's values from JWT, not attacker's
      expect(headers.get("X-User-Id")).toBe("dev-user-001");
      expect(headers.get("X-Org-Id")).toBe("dev-org-001");
      expect(headers.get("X-User-Email")).toBe("dev@localhost");
    });

    it("strips identity headers from public path requests", async () => {
      await makeRequest("/api/auth/login", {
        headers: {
          "X-User-Id": "attacker-id",
          "X-Org-Id": "attacker-org",
        },
      });

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const headers = fetchOptions.headers as Headers;
      expect(headers.get("X-User-Id")).toBeNull();
      expect(headers.get("X-Org-Id")).toBeNull();
    });
  });
});
