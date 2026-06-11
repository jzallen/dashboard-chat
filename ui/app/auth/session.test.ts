// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { keepAlive, logout } from "./session";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

function stubLocation(): { assign: ReturnType<typeof vi.fn> } {
  const loc = { assign: vi.fn(), href: "" };
  Object.defineProperty(window, "location", { configurable: true, value: loc });
  return loc;
}

describe("keepAlive", () => {
  it("POSTs the ui-state touch AND the auth refresh, both credentialed", async () => {
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await keepAlive();

    const urls = fetchSpy.mock.calls.map((c) => c[0]);
    expect(urls).toContain("/ui-state/state/keepalive");
    expect(urls).toContain("/api/auth/refresh");
    for (const [, init] of fetchSpy.mock.calls) {
      expect(init?.method).toBe("POST");
      expect(init?.credentials).toBe("include");
    }
  });

  it("never rejects even when a leg fails (best-effort)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    await expect(keepAlive()).resolves.toBeUndefined();
  });
});

describe("logout", () => {
  it("clears ui-state first, then follows the WorkOS end-session url", async () => {
    const loc = stubLocation();
    const fetchSpy = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ logout_url: "https://workos/logout" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await logout();

    const urls = fetchSpy.mock.calls.map((c) => c[0]);
    // ui-state clear happens BEFORE the auth-proxy logout (cookie still valid).
    expect(urls.indexOf("/ui-state/state/logout")).toBeLessThan(
      urls.indexOf("/api/auth/logout"),
    );
    expect(loc.assign).toHaveBeenCalledWith("https://workos/logout");
  });

  it("falls back to /login on a bodyless 204", async () => {
    const loc = stubLocation();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));

    await logout();

    expect(loc.assign).toHaveBeenCalledWith("/login");
  });

  it("falls back to /login when the logout call fails", async () => {
    const loc = stubLocation();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );

    await logout();

    expect(loc.assign).toHaveBeenCalledWith("/login");
  });
});
