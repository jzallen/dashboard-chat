// @vitest-environment node
// Resource-route action: ui-server-side code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./ui-server-dataset-patch";

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

function patchRequest(body: unknown): Request {
  return new Request("http://localhost/ui-server/datasets/d1", {
    method: "PATCH",
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

describe("/ui-server/datasets/:datasetId resource route", () => {
  it("forwards PATCH to the backend dataset endpoint through auth-proxy, carrying the credential AND the JSON body", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: patchRequest({ display_name: "Customers" }),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/datasets/d1`);
    expect(init.method).toBe("PATCH");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      display_name: "Customers",
    });
  });

  it("is body-agnostic: forwards a model_name body to the same endpoint", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: patchRequest({ model_name: "stg_warm_leads" }),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/datasets/d1`);
    expect(JSON.parse(init.body as string)).toEqual({
      model_name: "stg_warm_leads",
    });
  });

  it("forwards the upstream 2xx status AND body through (not a canned response)", async () => {
    // A distinctive upstream body proves the action returns what the backend
    // actually sent, not a hardcoded status/body — a stub action that always
    // replied `{}`/200 would fail this.
    stubFetch(new Response('{"id":"d1","display_name":"X"}', { status: 200 }));

    const res = await action({
      request: patchRequest({ display_name: "X" }),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"id":"d1","display_name":"X"}');
  });

  it("passes a non-2xx upstream (e.g. 409 collision) through unchanged WITHOUT redirecting", async () => {
    stubFetch(new Response("conflict", { status: 409 }));

    const res = await action({
      request: patchRequest({ model_name: "dupe" }),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    expect(res.status).toBe(409);
    expect(res.headers.get("location")).toBeNull();
  });

  it("URL-encodes the datasetId when building the upstream path", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: patchRequest({ display_name: "X" }),
      params: { datasetId: "ds/with space" },
      context: {},
    } as never);

    expect(captured().url).toBe(
      `${AUTH_PROXY_URL}/api/datasets/ds%2Fwith%20space`,
    );
  });
});
