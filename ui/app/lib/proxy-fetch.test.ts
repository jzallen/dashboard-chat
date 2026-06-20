// @vitest-environment node
// proxy-fetch is server-side ui-server code; test it under node's undici Request/
// Headers/fetch (matching the RRv7 server runtime), not happy-dom.
//
// AC3 (DC-8): the ONE shared forwarding primitive targets `authProxyUrl + <prefix>
// + <path>` and forwards `cookie` + `authorization`, omits absent credential
// headers, and works for BOTH the `/worker` and `/api` prefixes — proving there is
// no duplicated cookie-copy logic between the two hops.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxyFetch } from "./proxy-fetch";

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

describe("proxyFetch — the one shared forwarding primitive (AC3)", () => {
  it("targets authProxyUrl + <prefix> + <path> and forwards cookie + authorization for the /worker prefix", async () => {
    const calls = stubFetch(new Response("ok"));
    const request = new Request("http://localhost/ui-server/health", {
      headers: new Headers({
        cookie: "session=1; auth_token=abc",
        authorization: "Bearer user-jwt",
      }),
    });

    await proxyFetch(request, "/worker", "/health");

    const [{ url, init }] = calls();
    expect(url).toBe(`${AUTH_PROXY_URL}/worker/health`);
    const headers = new Headers(init.headers);
    expect(headers.get("cookie")).toBe("session=1; auth_token=abc");
    expect(headers.get("authorization")).toBe("Bearer user-jwt");
  });

  it("targets authProxyUrl + <prefix> + <path> and forwards the credential for the /api prefix", async () => {
    const calls = stubFetch(new Response("ok"));
    const request = new Request("http://localhost/ui-server/projects", {
      headers: new Headers({
        cookie: "session=1; auth_token=abc",
        authorization: "Bearer user-jwt",
      }),
    });

    await proxyFetch(request, "/api", "/projects");

    const [{ url, init }] = calls();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/projects`);
    const headers = new Headers(init.headers);
    expect(headers.get("cookie")).toBe("session=1; auth_token=abc");
    expect(headers.get("authorization")).toBe("Bearer user-jwt");
  });

  it("omits credential headers that are absent on the inbound request", async () => {
    const calls = stubFetch(new Response("ok"));
    const request = new Request("http://localhost/ui-server/projects"); // no cookie/auth

    await proxyFetch(request, "/api", "/projects");

    const headers = new Headers(calls()[0].init.headers);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
  });

  it("returns the raw upstream Response unmodified (no body read)", async () => {
    const upstream = new Response("data: x\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    stubFetch(upstream);
    const request = new Request("http://localhost/ui-server/chat", { method: "POST" });

    const res = await proxyFetch(request, "/worker", "/chat", { method: "POST" });
    expect(res).toBe(upstream);
    expect(res.bodyUsed).toBe(false);
  });
});
