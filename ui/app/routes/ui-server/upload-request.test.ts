// @vitest-environment node
// Resource-route action: ui-server-side code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./upload-request";

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

function uploadRequest(body: unknown): Request {
  return new Request("http://localhost/ui-server/sources/s1/uploads", {
    method: "POST",
    headers: new Headers({
      cookie: "session=1",
      authorization: "Bearer user-jwt",
      "content-type": "application/json",
    }),
    body: JSON.stringify(body),
  });
}

const DESCRIPTOR = {
  filename: "orders.csv",
  content_type: "text/csv",
  size: 1234,
};

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("/ui-server/sources/:sourceId/uploads resource route (upload request + presign)", () => {
  it("forwards POST to the backend uploads endpoint through auth-proxy, carrying the credential AND the descriptor body", async () => {
    const captured = stubFetch(new Response("{}", { status: 202 }));

    await action({
      request: uploadRequest(DESCRIPTOR),
      params: { sourceId: "s1" },
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/sources/s1/uploads`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
    expect(JSON.parse(init.body as string)).toEqual(DESCRIPTOR);
  });

  it("passes the RAW 202 presign body + status straight through (browser PUTs to put_url next)", async () => {
    const presign =
      '{"upload_id":"up.1","put_url":"https://minio.local/k?sig=abc","storage_key":"uploads/p1/s1/up.1/orders.csv","status":"pending"}';
    stubFetch(new Response(presign, { status: 202 }));

    const res = await action({
      request: uploadRequest(DESCRIPTOR),
      params: { sourceId: "s1" },
      context: {},
    } as never);

    expect(res.status).toBe(202);
    expect(await res.text()).toBe(presign);
  });

  it("passes a non-2xx upstream through unchanged WITHOUT redirecting (saga rolls back)", async () => {
    stubFetch(new Response("nope", { status: 401 }));

    const res = await action({
      request: uploadRequest(DESCRIPTOR),
      params: { sourceId: "s1" },
      context: {},
    } as never);

    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("URL-encodes the sourceId when building the upstream path", async () => {
    const captured = stubFetch(new Response("{}", { status: 202 }));

    await action({
      request: uploadRequest(DESCRIPTOR),
      params: { sourceId: "src/with space" },
      context: {},
    } as never);

    expect(captured().url).toBe(
      `${AUTH_PROXY_URL}/api/sources/src%2Fwith%20space/uploads`,
    );
  });
});
