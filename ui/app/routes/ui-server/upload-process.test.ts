// @vitest-environment node
// Resource-route action: ui-server-side code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./upload-process";

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

function processRequest(body: unknown): Request {
  return new Request(
    "http://localhost/ui-server/sources/s1/uploads/up.1/process",
    {
      method: "POST",
      headers: new Headers({
        cookie: "session=1",
        authorization: "Bearer user-jwt",
        "content-type": "application/json",
      }),
      body: JSON.stringify(body),
    },
  );
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("/ui-server/sources/:sourceId/uploads/:uploadId/process resource route (process)", () => {
  it("forwards POST to the backend process endpoint through auth-proxy, carrying the credential AND the JSON body", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: processRequest({ choices: { sheet: "Sheet1" } }),
      params: { sourceId: "s1", uploadId: "up.1" },
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/sources/s1/uploads/up.1/process`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      choices: { sheet: "Sheet1" },
    });
  });

  it("forwards the upstream 2xx status AND linked-dataset body through", async () => {
    stubFetch(
      new Response('{"data":{"type":"datasets","id":"ds.linked"}}', {
        status: 200,
      }),
    );

    const res = await action({
      request: processRequest({}),
      params: { sourceId: "s1", uploadId: "up.1" },
      context: {},
    } as never);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"data":{"type":"datasets","id":"ds.linked"}}');
  });

  it("passes a 422 SchemaMismatch through byte-intact WITHOUT redirecting (recovery UX parses the body)", async () => {
    const mismatch =
      '{"detail":{"missing":["age"],"extra":["nickname"],"type_mismatch":["email"]}}';
    stubFetch(new Response(mismatch, { status: 422 }));

    const res = await action({
      request: processRequest({}),
      params: { sourceId: "s1", uploadId: "up.1" },
      context: {},
    } as never);

    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toBe(mismatch);
  });

  it("URL-encodes the sourceId and uploadId when building the upstream path", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: processRequest({}),
      params: { sourceId: "src/a", uploadId: "up/b" },
      context: {},
    } as never);

    expect(captured().url).toBe(
      `${AUTH_PROXY_URL}/api/sources/src%2Fa/uploads/up%2Fb/process`,
    );
  });
});
