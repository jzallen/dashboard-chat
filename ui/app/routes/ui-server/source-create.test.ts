// @vitest-environment node
// Resource-route action: ui-server-side code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./source-create";

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

function createRequest(body: unknown): Request {
  return new Request("http://localhost/ui-server/sources", {
    method: "POST",
    headers: new Headers({
      cookie: "session=1",
      authorization: "Bearer user-jwt",
      "content-type": "application/json",
    }),
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("/ui-server/sources resource route (source create)", () => {
  it("forwards POST to the backend /api/sources endpoint through auth-proxy, carrying the credential AND the JSON body", async () => {
    const captured = stubFetch(new Response("{}", { status: 201 }));

    await action({
      request: createRequest({ project_id: "p1", name: "orders_csv" }),
      params: {},
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/sources`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      project_id: "p1",
      name: "orders_csv",
    });
  });

  it("forwards the upstream 2xx status AND body through (the saga reads the created source id)", async () => {
    stubFetch(
      new Response('{"data":{"type":"sources","id":"src.new"}}', {
        status: 201,
      }),
    );

    const res = await action({
      request: createRequest({ project_id: "p1", name: "orders_csv" }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"data":{"type":"sources","id":"src.new"}}');
  });

  it("passes a non-2xx upstream through unchanged WITHOUT redirecting (saga rolls back)", async () => {
    stubFetch(new Response("nope", { status: 401 }));

    const res = await action({
      request: createRequest({ project_id: "p1", name: "x" }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });
});
