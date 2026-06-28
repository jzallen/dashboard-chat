// @vitest-environment node
// Resource-route action: ui-server-side code, tested under node's undici.
// The action reuses the (already-implemented) brokerPost; these cases pin the
// definitive org-create answers the driver maps (DC-131 / AC2).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./orgs";

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
  return new Request("http://localhost/ui-server/orgs", {
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

describe("/ui-server/orgs resource route (org create)", () => {
  it("forwards POST to the backend /api/orgs endpoint through auth-proxy, carrying the credential AND the JSON body", async () => {
    const captured = stubFetch(new Response("{}", { status: 201 }));

    await action({
      request: createRequest({ name: "Acme" }),
      params: {},
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/orgs`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
    expect(JSON.parse(init.body as string)).toEqual({ name: "Acme" });
  });

  it("forwards the upstream 201 status AND body through (the driver reads the created org snapshot)", async () => {
    stubFetch(
      new Response('{"data":{"type":"orgs","id":"org-7"}}', { status: 201 }),
    );

    const res = await action({
      request: createRequest({ name: "Acme" }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"data":{"type":"orgs","id":"org-7"}}');
  });

  it("passes a 409 (org_name_taken) through unchanged WITHOUT redirecting", async () => {
    stubFetch(new Response('{"error":"taken"}', { status: 409 }));

    const res = await action({
      request: createRequest({ name: "Acme" }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(409);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toBe('{"error":"taken"}');
  });

  it("passes a 422 (org_name_invalid) through unchanged WITHOUT redirecting", async () => {
    stubFetch(new Response('{"error":"invalid"}', { status: 422 }));

    const res = await action({
      request: createRequest({ name: "" }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(422);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toBe('{"error":"invalid"}');
  });
});
