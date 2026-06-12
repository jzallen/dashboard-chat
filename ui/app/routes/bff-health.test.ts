// @vitest-environment node
// Resource-route loader: server-side BFF code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "./bff-health";

const AUTH_PROXY_URL = "http://auth-proxy.test";

function stubFetch(impl: (url: string, init: RequestInit) => Response): string[] {
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL).href;
      seen.push(url);
      return impl(url, init ?? {});
    },
  );
  return seen;
}

function req(): Request {
  return new Request("http://localhost/bff/health", {
    headers: new Headers({ cookie: "session=1" }),
  });
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("/bff/health resource route (auth-hop proof)", () => {
  it("relays the agent health status server-side through /worker/health", async () => {
    const seen = stubFetch(
      () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );

    const res = await loader({ request: req(), params: {}, context: {} } as never);

    expect(seen).toEqual([`${AUTH_PROXY_URL}/worker/health`]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("reports 502 when the agent hop is unhealthy", async () => {
    stubFetch(() => new Response("down", { status: 503 }));

    const res = await loader({ request: req(), params: {}, context: {} } as never);

    expect(res.status).toBe(502);
  });
});
