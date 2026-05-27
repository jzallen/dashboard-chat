/**
 * Test plan — `WorkOsUserAuthProvider`
 *
 * Source under test: `auth-proxy/lib/user-auth/workos.ts`
 *
 * The production user-auth provider. Exchanges WorkOS auth codes for tokens,
 * stores the WorkOS `refresh_token` in the session-store keyed by `sid`, and
 * mints a local auth-proxy JWT to return to the FE. Per OQ1 (b): **the WorkOS
 * refresh_token never leaves the server.** Row #10 is the invariant that
 * makes the OQ1 (b) posture real — if it can fail, the FE can hold the
 * WorkOS token and the security upgrade dissolves.
 *
 * All WorkOS HTTP calls go through an injected `fetch` port (mirroring
 * `backend/app/auth/workos_provider.py:89-120`'s use of an HTTP client).
 * Tests mock the fetch port; **no test in this file hits the real WorkOS** —
 * doing so would defeat the dev-mode-isolation principle that motivated this
 * design.
 *
 * All 14 rows of the original test plan are landed. The describe blocks
 * below pin the implemented behaviour; the git log carries the row-by-row
 * narrative.
 *
 * **Notes for the agent:**
 * - Construct the provider with `{fetch: mockFetch, sessionStore: inMemoryStore, config: {...}}` — DI everything. No real fetch, no JSONL.
 * - Row #10 is the security invariant. Consider a `serializeForTransport()` helper or just inspect every method's return shape.
 * - For row #14: WorkOS may or may not support idempotent refresh. The implementation can use a per-sid mutex; the test asserts the OUTCOME (consistent state), not the mechanism.
 * - Do not commit a fixture WORKOS_CLIENT_ID or secret — use `"test-client"` / `"test-secret"` strings.
 */

import { decodeProtectedHeader } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetKeypairForTests } from "../keypair.ts";
import type {
  SessionLookup,
  SessionPayload,
} from "../session-store.ts";
import { WorkOsUserAuthProvider } from "./workos.ts";

const TEST_CONFIG = {
  baseUrl: "https://workos.test",
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "https://app.example/auth/callback",
  sessionTtlSeconds: 3600,
};

interface InMemorySessionStore {
  set(sid: string, payload: SessionPayload): void;
  get(sid: string): SessionPayload | null;
  getStatus(sid: string): SessionLookup;
  delete(sid: string): boolean;
  /** Snapshot of all entries — convenience for tests. */
  _all(): Map<string, SessionPayload>;
}

function createInMemorySessionStore(): InMemorySessionStore {
  const map = new Map<string, SessionPayload>();
  return {
    set(sid, payload) {
      map.set(sid, payload);
    },
    get(sid) {
      const entry = map.get(sid);
      if (!entry) return null;
      if (entry.expires_at < Math.floor(Date.now() / 1000)) {
        map.delete(sid);
        return null;
      }
      return entry;
    },
    getStatus(sid) {
      const entry = map.get(sid);
      if (!entry) return { status: "missing" };
      if (entry.expires_at < Math.floor(Date.now() / 1000)) {
        map.delete(sid);
        return { status: "expired" };
      }
      return { status: "valid", payload: entry };
    },
    delete(sid) {
      return map.delete(sid);
    },
    _all() {
      return new Map(map);
    },
  };
}

function workosOkResponse(overrides: Partial<{
  access_token: string;
  refresh_token: string;
  user: { id: string; email: string; first_name?: string };
  organization_id: string;
}> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: "wos-access-default",
      refresh_token: "wos-refresh-default",
      user: { id: "wos-user-default", email: "u@example", first_name: "U" },
      organization_id: "wos-org-default",
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

const NOW_SEC = 1_700_000_000;

/**
 * Freeze time for the duration of the test so `expires_at` assertions
 * stay deterministic across the `Math.floor(Date.now() / 1000)` boundary.
 * Wrap the test body; the helper restores real timers in `finally`.
 */
async function withFrozenTime<T>(fn: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  vi.setSystemTime(NOW_SEC * 1000);
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(() => {
  _resetKeypairForTests();
});

afterEach(() => {
  _resetKeypairForTests();
});

describe("WorkOsUserAuthProvider", () => {
  describe("handleCallback", () => {
    it("POSTs the auth code to WorkOS authenticate with client credentials", async () => {
      const mockFetch = vi.fn().mockResolvedValue(workosOkResponse());
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore: createInMemorySessionStore(),
        config: TEST_CONFIG,
      });

      const result = await provider.handleCallback({
        code: "wos-code-1",
        state: "state-1",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://workos.test/user_management/authenticate");
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({
        client_id: "test-client",
        client_secret: "test-secret",
        code: "wos-code-1",
        grant_type: "authorization_code",
        redirect_uri: "https://app.example/auth/callback",
      });

      expect(typeof result.accessToken).toBe("string");
      expect(result.accessToken.split(".")).toHaveLength(3);
      expect(decodeProtectedHeader(result.accessToken).kid).toBe(
        "auth-proxy:user:1",
      );
    });

    it("stores the WorkOS refresh_token in the session-store keyed by the new sid", async () => {
      await withFrozenTime(async () => {
        const sessionStore = createInMemorySessionStore();
        const mockFetch = vi.fn().mockResolvedValue(
          workosOkResponse({
            refresh_token: "wos-r-from-callback",
            user: {
              id: "wos-user-2",
              email: "u2@example",
              first_name: "Two",
            },
            organization_id: "wos-org-2",
          }),
        );
        const provider = new WorkOsUserAuthProvider({
          fetch: mockFetch,
          sessionStore,
          config: TEST_CONFIG,
        });

        const result = await provider.handleCallback({
          code: "wos-code-2",
          state: "state-2",
        });

        expect(sessionStore.get(result.sid)).toEqual({
          workos_refresh_token: "wos-r-from-callback",
          expires_at: NOW_SEC + result.expiresIn,
          user_claims: {
            sub: "wos-user-2",
            email: "u2@example",
            name: "Two",
            org_id: "wos-org-2",
          },
        });
      });
    });

    it("does not surface the WorkOS refresh_token in the return value", async () => {
      const sessionStore = createInMemorySessionStore();
      const mockFetch = vi.fn().mockResolvedValue(
        workosOkResponse({ refresh_token: "wos-r-must-stay-server-side" }),
      );
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      const result = await provider.handleCallback({
        code: "wos-code-3",
        state: "state-3",
      });

      expect(JSON.stringify(result)).not.toContain(
        "wos-r-must-stay-server-side",
      );
      expect(result).toEqual({
        accessToken: expect.any(String),
        sid: expect.any(String),
        expiresIn: expect.any(Number),
      });
    });
  });

  describe("refresh", () => {
    it("sends the stored WorkOS refresh_token when refreshing a sid", async () => {
      const sessionStore = createInMemorySessionStore();
      sessionStore.set("sid-known", {
        workos_refresh_token: "wos-r-123",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user_claims: {
          sub: "wos-user-known",
          email: "known@example",
          name: "Known",
          org_id: "wos-org-known",
        },
      });
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          workosOkResponse({ refresh_token: "wos-r-rotated-ignored" }),
        );
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await provider.refresh("sid-known");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://workos.test/user_management/authenticate");
      expect(JSON.parse(init.body as string)).toEqual({
        client_id: "test-client",
        client_secret: "test-secret",
        grant_type: "refresh_token",
        refresh_token: "wos-r-123",
      });
    });

    it("rotates the stored WorkOS refresh_token with the value WorkOS returns", async () => {
      await withFrozenTime(async () => {
        const sessionStore = createInMemorySessionStore();
        const userClaims = {
          sub: "wos-user-known",
          email: "known@example",
          name: "Known",
          org_id: "wos-org-known",
        };
        sessionStore.set("sid-known", {
          workos_refresh_token: "wos-r-old",
          expires_at: NOW_SEC + 3600,
          user_claims: userClaims,
        });
        const mockFetch = vi
          .fn()
          .mockResolvedValue(workosOkResponse({ refresh_token: "wos-r-new" }));
        const provider = new WorkOsUserAuthProvider({
          fetch: mockFetch,
          sessionStore,
          config: TEST_CONFIG,
        });

        const { expiresIn } = await provider.refresh("sid-known");

        expect(sessionStore.get("sid-known")).toEqual({
          workos_refresh_token: "wos-r-new",
          expires_at: NOW_SEC + expiresIn,
          user_claims: userClaims,
        });
      });
    });

    it("returns a freshly-minted local JWT and never the WorkOS refresh_token", async () => {
      const sessionStore = createInMemorySessionStore();
      sessionStore.set("sid-known", {
        workos_refresh_token: "wos-r-secret-OLD",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user_claims: {
          sub: "wos-user-known",
          email: "known@example",
          name: "Known",
          org_id: "wos-org-known",
        },
      });
      const mockFetch = vi
        .fn()
        .mockResolvedValue(
          workosOkResponse({ refresh_token: "wos-r-secret-NEW" }),
        );
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      const result = await provider.refresh("sid-known");

      expect(JSON.stringify(result)).not.toContain("wos-r-secret-OLD");
      expect(JSON.stringify(result)).not.toContain("wos-r-secret-NEW");
      expect(result).toEqual({
        accessToken: expect.any(String),
        expiresIn: expect.any(Number),
      });
      expect(decodeProtectedHeader(result.accessToken).kid).toBe(
        "auth-proxy:user:1",
      );
    });

    it("rejects with invalid_session when the sid is unknown", async () => {
      const sessionStore = createInMemorySessionStore();
      const mockFetch = vi.fn().mockResolvedValue(workosOkResponse());
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await expect(provider.refresh("never-existed")).rejects.toThrow(
        "invalid_session",
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects with invalid_session when the session-store entry has expired", async () => {
      const sessionStore = createInMemorySessionStore();
      sessionStore.set("sid-expired", {
        workos_refresh_token: "wos-r-stale",
        expires_at: Math.floor(Date.now() / 1000) - 60,
        user_claims: {
          sub: "wos-user-stale",
          email: "stale@example",
          name: "Stale",
          org_id: "wos-org-stale",
        },
      });
      const mockFetch = vi.fn().mockResolvedValue(workosOkResponse());
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await expect(provider.refresh("sid-expired")).rejects.toThrow(
        "invalid_session",
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("logout", () => {
    function seedSession(
      store: InMemorySessionStore,
      sid: string,
      refreshToken: string,
    ) {
      store.set(sid, {
        workos_refresh_token: refreshToken,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user_claims: {
          sub: "wos-user-logout",
          email: "logout@example",
          name: "Logout",
          org_id: "wos-org-logout",
        },
      });
    }

    it("deletes the session-store entry for the sid", async () => {
      const sessionStore = createInMemorySessionStore();
      seedSession(sessionStore, "sid-logout", "wos-r-logout");
      const mockFetch = vi.fn().mockResolvedValue(workosOkResponse());
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await provider.logout("sid-logout");

      expect(sessionStore.get("sid-logout")).toBeNull();
    });

    it("does not call WorkOS when revokeOnLogout is unset (default)", async () => {
      const sessionStore = createInMemorySessionStore();
      seedSession(sessionStore, "sid-no-revoke", "wos-r-keep");
      const mockFetch = vi.fn().mockResolvedValue(workosOkResponse());
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await provider.logout("sid-no-revoke");

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("calls the WorkOS revoke endpoint when revokeOnLogout is true", async () => {
      const sessionStore = createInMemorySessionStore();
      seedSession(sessionStore, "sid-revoke", "wos-r-revoke-me");
      const mockFetch = vi.fn().mockResolvedValue(workosOkResponse());
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: { ...TEST_CONFIG, revokeOnLogout: true },
      });

      await provider.logout("sid-revoke");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toMatch(/^https:\/\/workos\.test\/user_management\/.*revoke/);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.refresh_token).toBe("wos-r-revoke-me");
      expect(sessionStore.get("sid-revoke")).toBeNull();
    });
  });

  describe("error mapping", () => {
    it("handleCallback rejects with unauthorized when WorkOS returns 401", async () => {
      const sessionStore = createInMemorySessionStore();
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      );
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await expect(
        provider.handleCallback({ code: "bad-code", state: "any" }),
      ).rejects.toThrow("unauthorized");
      expect(sessionStore._all().size).toBe(0);
    });

    it("handleCallback rejects with service_error when WorkOS returns 503", async () => {
      const sessionStore = createInMemorySessionStore();
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("Service Unavailable", { status: 503 }),
      );
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await expect(
        provider.handleCallback({ code: "x", state: "y" }),
      ).rejects.toThrow("service_error");
      expect(sessionStore._all().size).toBe(0);
    });

    it("refresh rejects with service_error on WorkOS 503 and leaves the session-store entry alone", async () => {
      const sessionStore = createInMemorySessionStore();
      const seeded = {
        workos_refresh_token: "wos-r-503",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user_claims: {
          sub: "wos-user-503",
          email: "u@example",
          name: "U",
          org_id: "wos-org-503",
        },
      };
      sessionStore.set("sid-503", seeded);
      const mockFetch = vi.fn().mockResolvedValue(
        new Response("Service Unavailable", { status: 503 }),
      );
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await expect(provider.refresh("sid-503")).rejects.toThrow(
        "service_error",
      );
      expect(sessionStore.get("sid-503")).toEqual(seeded);
    });

    it("handleCallback rejects with service_error when fetch itself throws (network down)", async () => {
      const sessionStore = createInMemorySessionStore();
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await expect(
        provider.handleCallback({ code: "x", state: "y" }),
      ).rejects.toThrow("service_error");
      expect(sessionStore._all().size).toBe(0);
    });

    it("refresh rejects with service_error when fetch throws and leaves the session-store entry alone", async () => {
      const sessionStore = createInMemorySessionStore();
      const seeded = {
        workos_refresh_token: "wos-r-net",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user_claims: {
          sub: "wos-user-net",
          email: "u@example",
          name: "U",
          org_id: "wos-org-net",
        },
      };
      sessionStore.set("sid-net", seeded);
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await expect(provider.refresh("sid-net")).rejects.toThrow(
        "service_error",
      );
      expect(sessionStore.get("sid-net")).toEqual(seeded);
    });

    it("refresh rejects with unauthorized when WorkOS returns 401 and leaves the session-store entry alone", async () => {
      const sessionStore = createInMemorySessionStore();
      const seeded = {
        workos_refresh_token: "wos-r-stale",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user_claims: {
          sub: "wos-user-401",
          email: "u@example",
          name: "U",
          org_id: "wos-org-1",
        },
      };
      sessionStore.set("sid-401", seeded);
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      );
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      await expect(provider.refresh("sid-401")).rejects.toThrow(
        "unauthorized",
      );
      expect(sessionStore.get("sid-401")).toEqual(seeded);
    });
  });

  describe("concurrency", () => {
    it("two concurrent refresh calls for the same sid leave the session-store consistent", async () => {
      const sessionStore = createInMemorySessionStore();
      sessionStore.set("sid-concurrent", {
        workos_refresh_token: "wos-r-base",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user_claims: {
          sub: "wos-user-c",
          email: "c@example",
          name: "C",
          org_id: "wos-org-c",
        },
      });
      // Each authenticate response returns a distinct rotated token so we
      // can observe last-write-wins (or per-sid serialization if the impl
      // chooses one).
      const rotations = ["wos-r-rotated-A", "wos-r-rotated-B"];
      let call = 0;
      const mockFetch = vi.fn(async () =>
        workosOkResponse({ refresh_token: rotations[call++] }),
      );
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: TEST_CONFIG,
      });

      const results = await Promise.allSettled([
        provider.refresh("sid-concurrent"),
        provider.refresh("sid-concurrent"),
      ]);

      // At least one call resolved cleanly; any failure is also acceptable
      // per the test plan but the store must remain coherent.
      const resolvedCount = results.filter(
        (r) => r.status === "fulfilled",
      ).length;
      expect(resolvedCount).toBeGreaterThanOrEqual(1);

      const all = sessionStore._all();
      expect(all.size).toBe(1);
      const stored = all.get("sid-concurrent")!;
      expect(typeof stored.workos_refresh_token).toBe("string");
      expect(typeof stored.expires_at).toBe("number");
      expect(rotations).toContain(stored.workos_refresh_token);
    });
  });

  describe("OQ1 (b) security invariant", () => {
    it("the WorkOS refresh_token never escapes the provider", async () => {
      const SECRET = "WOS-SECRET-DO-NOT-LEAK-ABC123";
      const SECRET_ROTATED = "WOS-SECRET-DO-NOT-LEAK-XYZ789";
      const sessionStore = createInMemorySessionStore();
      const mockFetch = vi.fn(async (input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : (input as Request).url;
        if (url.endsWith("/user_management/authenticate")) {
          // First call serves the callback exchange (original secret),
          // every subsequent call serves a rotation.
          const prior = mockFetch.mock.calls.filter(
            ([i]) =>
              (typeof i === "string"
                ? i
                : i instanceof URL
                  ? i.toString()
                  : (i as Request).url) ===
              "https://workos.test/user_management/authenticate",
          ).length;
          return workosOkResponse({
            refresh_token: prior <= 1 ? SECRET : SECRET_ROTATED,
          });
        }
        return workosOkResponse();
      });
      const provider = new WorkOsUserAuthProvider({
        fetch: mockFetch,
        sessionStore,
        config: { ...TEST_CONFIG, revokeOnLogout: true },
      });

      const callback = await provider.handleCallback({
        code: "any-code",
        state: "any-state",
      });
      const refreshed = await provider.refresh(callback.sid);

      let caught: unknown = null;
      try {
        await provider.refresh("never-existed");
      } catch (e) {
        caught = e;
      }
      const logoutReturn = await provider.logout(callback.sid);

      const surfaces = [
        JSON.stringify(callback),
        JSON.stringify(refreshed),
        String((caught as Error).message),
        JSON.stringify(logoutReturn ?? null),
      ];
      for (const surface of surfaces) {
        expect(surface).not.toContain(SECRET);
        expect(surface).not.toContain(SECRET_ROTATED);
      }
    });
  });
});

