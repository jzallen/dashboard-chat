// @vitest-environment node
// Resource-route loader: ui-server-side code, tested under node's undici.
// RED until brokerGet is implemented (DC-130 / AC1).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader } from "./orgs-me";

const AUTH_PROXY_URL = "http://auth-proxy.test";

type Captured = { url: string; init: RequestInit };

function stubFetch(response: Response): () => Captured {
  let captured: Captured;
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : (input as URL).href;
      captured = { url, init: init ?? {} };
      return response;
    },
  );
  return () => captured;
}

function createRequest(): Request {
  return new Request("http://localhost/ui-server/orgs/me", {
    method: "GET",
    headers: new Headers({
      cookie: "session=1",
      authorization: "Bearer user-jwt",
    }),
  });
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("/ui-server/orgs/me resource route (org probe)", () => {
  it("forwards GET to the backend /api/orgs/me endpoint through auth-proxy, carrying the credential", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await loader({ request: createRequest(), params: {}, context: {} } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/orgs/me`);
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
  });

  it("flattens the JSON:API envelope on a 2xx (the broker owns the unwrap; the driver reads a flat org snapshot)", async () => {
    stubFetch(
      new Response(
        '{"data":{"type":"orgs","id":"org-7","attributes":{"name":"Acme"}}}',
        { status: 200 },
      ),
    );

    const res = await loader({
      request: createRequest(),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text())).toEqual({ id: "org-7", name: "Acme" });
  });

  it("passes a definitive 404 (org_not_found) through unchanged WITHOUT redirecting", async () => {
    stubFetch(new Response('{"error":"no org"}', { status: 404 }));

    const res = await loader({
      request: createRequest(),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toBe('{"error":"no org"}');
  });
});
