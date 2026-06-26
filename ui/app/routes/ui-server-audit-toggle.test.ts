// @vitest-environment node
// Resource-route action: ui-server-side code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./ui-server-audit-toggle";

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

function toggleRequest(body: unknown): Request {
  return new Request("http://localhost/ui-server/projects/p1/audit/ae1", {
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

describe("/ui-server/projects/:projectId/audit/:auditEntryId resource route", () => {
  it("forwards PATCH to the backend audit endpoint through auth-proxy, carrying the credential AND the JSON body", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: toggleRequest({ enabled: false }),
      params: { projectId: "p1", auditEntryId: "ae1" },
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/projects/p1/audit/ae1`);
    expect(init.method).toBe("PATCH");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
    expect(JSON.parse(init.body as string)).toEqual({ enabled: false });
  });

  it("forwards the upstream 2xx status AND body through (not a canned response)", async () => {
    // A distinctive upstream body proves the action returns what the backend
    // actually sent, not a hardcoded status/body.
    stubFetch(new Response('{"id":"ae1","enabled":true}', { status: 200 }));

    const res = await action({
      request: toggleRequest({ enabled: true }),
      params: { projectId: "p1", auditEntryId: "ae1" },
      context: {},
    } as never);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"id":"ae1","enabled":true}');
  });

  it("passes a non-2xx upstream through unchanged WITHOUT redirecting (rollback-friendly)", async () => {
    stubFetch(new Response("nope", { status: 401 }));

    const res = await action({
      request: toggleRequest({ enabled: true }),
      params: { projectId: "p1", auditEntryId: "ae1" },
      context: {},
    } as never);

    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  it("URL-encodes the projectId and auditEntryId when building the upstream path", async () => {
    const captured = stubFetch(new Response("{}", { status: 200 }));

    await action({
      request: toggleRequest({ enabled: true }),
      params: { projectId: "p/1", auditEntryId: "ae 1" },
      context: {},
    } as never);

    expect(captured().url).toBe(
      `${AUTH_PROXY_URL}/api/projects/p%2F1/audit/ae%201`,
    );
  });
});
