// @vitest-environment node
// api-client is server-side BFF code; test it under node's undici Request/
// Headers/fetch (matching the RRv7 server runtime), not happy-dom.
//
// AC1 (DC-8): `apiFetch` targets `/api/<path>`, forwards the inbound credential,
// and returns the raw upstream Response — with no `credentials:"include"` browser
// fetch involved.
// AC2 (DC-8): a 401 upstream surfaces the unauthenticated signal a loader turns
// into a `/login` redirect.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, ApiUnauthenticatedError, assertAuthenticated } from "./api-client";

const AUTH_PROXY_URL = "http://auth-proxy.test";

type Captured = { url: string; init: RequestInit };

function stubFetch(response: Response): () => Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      calls.push({ url, init: init ?? {} });
      return response;
    },
  );
  return () => calls;
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("apiFetch — server-side authenticated /api client", () => {
  it("targets /api/<path>, forwards the inbound credential, and returns the raw upstream Response (AC1)", async () => {
    const upstream = new Response('{"projects":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    const calls = stubFetch(upstream);
    const request = new Request("http://localhost/projects", {
      headers: new Headers({
        cookie: "session=1; auth_token=abc",
        authorization: "Bearer user-jwt",
      }),
    });

    const res = await apiFetch(request, "/projects");

    const [{ url, init }] = calls();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/projects`);
    const headers = new Headers(init.headers);
    expect(headers.get("cookie")).toBe("session=1; auth_token=abc");
    expect(headers.get("authorization")).toBe("Bearer user-jwt");
    // raw upstream Response, no browser credentials:"include" hop
    expect(res).toBe(upstream);
    expect(res.bodyUsed).toBe(false);
  });

  it("surfaces the unauthenticated signal on a 401 upstream (AC2)", async () => {
    const unauthorized = new Response("Unauthorized", { status: 401 });

    expect(() => assertAuthenticated(unauthorized)).toThrow(
      ApiUnauthenticatedError,
    );
  });

  it("passes a non-401 Response through unchanged (AC2)", async () => {
    const ok = new Response('{"projects":[]}', { status: 200 });

    expect(assertAuthenticated(ok)).toBe(ok);
  });
});
