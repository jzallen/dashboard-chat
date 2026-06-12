// @vitest-environment node
// agent-client is server-side BFF code; test it under node's undici Request/
// Headers/fetch (matching the RRv7 server runtime), not happy-dom.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { agentFetch } from "./agent-client";

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

describe("agentFetch — ui/ server-side downstream client", () => {
  it("targets auth-proxy's /worker/<path> and forwards cookie + authorization", async () => {
    const calls = stubFetch(new Response("ok"));
    // A server-received Request carries the Cookie header. Build it from a
    // pre-made Headers (guard "none") so the forbidden-name filter the object-init
    // path applies does not strip `cookie` (the runtime delivers it intact).
    const request = new Request("http://localhost/bff/health", {
      headers: new Headers({
        cookie: "session=1; auth_token=abc",
        authorization: "Bearer user-jwt",
      }),
    });

    await agentFetch(request, "/health");

    const [{ url, init }] = calls();
    expect(url).toBe(`${AUTH_PROXY_URL}/worker/health`);
    const headers = new Headers(init.headers);
    expect(headers.get("cookie")).toBe("session=1; auth_token=abc");
    expect(headers.get("authorization")).toBe("Bearer user-jwt");
  });

  it("passes method and body through for POST relays", async () => {
    const calls = stubFetch(new Response("ok"));
    const request = new Request("http://localhost/bff/chat", {
      method: "POST",
      headers: { cookie: "session=1" },
      body: JSON.stringify({ messages: [] }),
    });

    await agentFetch(request, "/chat", {
      method: "POST",
      body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      headers: { "content-type": "application/json" },
    });

    const [{ init }] = calls();
    expect(init.method).toBe("POST");
    expect(init.body).toBe(
      JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
    );
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("returns the upstream Response unmodified (stream passthrough)", async () => {
    const upstream = new Response("data: x\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    stubFetch(upstream);
    const request = new Request("http://localhost/bff/chat", {
      method: "POST",
    });

    const res = await agentFetch(request, "/chat", { method: "POST" });
    expect(res).toBe(upstream);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("omits credential headers that are absent on the inbound request", async () => {
    const calls = stubFetch(new Response("ok"));
    const request = new Request("http://localhost/bff/health"); // no cookie/auth

    await agentFetch(request, "/health");

    const headers = new Headers(calls()[0].init.headers);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("authorization")).toBe(false);
  });
});
