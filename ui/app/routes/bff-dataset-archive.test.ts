// @vitest-environment node
// Resource-route action: server-side BFF code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./bff-dataset-archive";

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

function archiveRequest(): Request {
  return new Request("http://localhost/bff/datasets/d1/archive", {
    method: "POST",
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

describe("/bff/datasets/:datasetId/archive resource route", () => {
  it("forwards POST to the backend archive endpoint through auth-proxy, carrying the user credential", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: archiveRequest(),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/datasets/d1/archive`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
  });

  it("passes a 2xx upstream status through", async () => {
    stubFetch(new Response("{}", { status: 200 }));

    const res = await action({
      request: archiveRequest(),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    expect(res.status).toBe(200);
  });

  it("passes a non-2xx upstream through unchanged WITHOUT redirecting (rollback-friendly)", async () => {
    stubFetch(new Response("nope", { status: 401 }));

    const res = await action({
      request: archiveRequest(),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    // A 401 must surface as 401, NOT a 302 to /login — this is a fetch target.
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("URL-encodes the datasetId when building the upstream path", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: new Request("http://localhost/bff/datasets/x/archive", {
        method: "POST",
        headers: new Headers({ cookie: "session=1" }),
      }),
      params: { datasetId: "ds/with space" },
      context: {},
    } as never);

    expect(captured().url).toBe(
      `${AUTH_PROXY_URL}/api/datasets/ds%2Fwith%20space/archive`,
    );
  });
});
