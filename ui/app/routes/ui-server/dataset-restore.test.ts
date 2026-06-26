// @vitest-environment node
// Resource-route action: ui-server-side code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./dataset-restore";

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

function restoreRequest(): Request {
  return new Request("http://localhost/ui-server/datasets/d1/restore", {
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

describe("/ui-server/datasets/:datasetId/restore resource route", () => {
  it("forwards POST to the backend restore endpoint through auth-proxy, carrying the user credential", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: restoreRequest(),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/datasets/d1/restore`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
  });

  it("passes a 2xx upstream status through", async () => {
    stubFetch(new Response("{}", { status: 200 }));

    const res = await action({
      request: restoreRequest(),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    expect(res.status).toBe(200);
  });

  it("passes a non-2xx upstream through unchanged WITHOUT redirecting (rollback-friendly)", async () => {
    stubFetch(new Response("not found", { status: 404 }));

    const res = await action({
      request: restoreRequest(),
      params: { datasetId: "d1" },
      context: {},
    } as never);

    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it("URL-encodes the datasetId when building the upstream path", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: new Request("http://localhost/ui-server/datasets/x/restore", {
        method: "POST",
        headers: new Headers({ cookie: "session=1" }),
      }),
      params: { datasetId: "ds/with space" },
      context: {},
    } as never);

    expect(captured().url).toBe(
      `${AUTH_PROXY_URL}/api/datasets/ds%2Fwith%20space/restore`,
    );
  });
});
