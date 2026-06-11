// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractCode, handleCallback } from "./bootstrap";

afterEach(() => {
  vi.unstubAllGlobals();
  // The memoized fetchAuthConfig promise lives at module scope; reset modules so
  // each memoization test re-imports a fresh (un-memoized) binding.
  vi.resetModules();
});

/** Re-import bootstrap fresh so its module-level memo cache starts empty. */
async function freshBootstrap() {
  return import("./bootstrap");
}

describe("handleCallback", () => {
  it("POSTs the code and resolves WITHOUT reading the response body (cookies are already set)", async () => {
    // The auth-proxy sets auth_token (httpOnly) + session=1 via Set-Cookie on the
    // callback response, so the SPA no longer reads the body access_token.
    const json = vi.fn(async () => ({ access_token: "leaked", expires_in: 3600 }));
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(handleCallback("dev-auth-code")).resolves.toBeUndefined();

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/auth/callback");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ code: "dev-auth-code" });
    expect(json).not.toHaveBeenCalled();
  });

  it("rejects on a non-2xx callback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(handleCallback("x")).rejects.toThrow(/callback failed/);
  });
});

describe("fetchAuthConfig", () => {
  it("GETs /api/auth/config and returns the validated { mode }", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ mode: "dev" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchAuthConfig } = await freshBootstrap();
    await expect(fetchAuthConfig()).resolves.toEqual({ mode: "dev" });

    const [url] = fetchSpy.mock.calls[0] as unknown as [string];
    expect(url).toBe("/api/auth/config");
  });

  it("memoizes — repeated calls fetch at most once per app load", async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ mode: "workos" }),
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchAuthConfig } = await freshBootstrap();
    const [a, b] = await Promise.all([fetchAuthConfig(), fetchAuthConfig()]);
    await fetchAuthConfig();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ mode: "workos" });
    expect(b).toEqual({ mode: "workos" });
  });

  it("ignores unknown future fields (passthrough) but keeps { mode }", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ mode: "dev", future_flag: true }),
      })),
    );

    const { fetchAuthConfig } = await freshBootstrap();
    await expect(fetchAuthConfig()).resolves.toMatchObject({ mode: "dev" });
  });

  it("rejects a malformed body (Zod validation at the boundary)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ mode: "banana" }),
      })),
    );

    const { fetchAuthConfig } = await freshBootstrap();
    await expect(fetchAuthConfig()).rejects.toThrow();
  });
});

describe("extractCode", () => {
  it("pulls the dev auth code out of the callback query string", () => {
    expect(extractCode("?code=dev-auth-code")).toBe("dev-auth-code");
  });

  it("returns null when no code is present", () => {
    expect(extractCode("?state=abc")).toBeNull();
  });
});
