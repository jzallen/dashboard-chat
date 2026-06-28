// @vitest-environment node
// Resource-route loader + action: ui-server-side code, tested under node's
// undici. The loader (retry-probe / initial scope) uses brokerGet — RED until it
// is implemented; the action (default-project create) reuses brokerPost
// (DC-133 / AC3).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action, loader } from "./projects";

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

function getRequest(): Request {
  return new Request("http://localhost/ui-server/projects", {
    method: "GET",
    headers: new Headers({
      cookie: "session=1",
      authorization: "Bearer user-jwt",
    }),
  });
}

function postRequest(body: unknown): Request {
  return new Request("http://localhost/ui-server/projects", {
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

describe("/ui-server/projects loader (retry-probe / initial scope)", () => {
  it("forwards GET to the backend /api/projects endpoint through auth-proxy, carrying the credential", async () => {
    const captured = stubFetch(new Response("[]", { status: 200 }));

    await loader({ request: getRequest(), params: {}, context: {} } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/projects`);
    expect(init.method).toBe("GET");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
  });

  it("passes an empty-list 200 through unchanged (the driver maps it to no_projects_found)", async () => {
    stubFetch(new Response('{"data":[]}', { status: 200 }));

    const res = await loader({
      request: getRequest(),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(await res.text()).toBe('{"data":[]}');
  });
});

describe("/ui-server/projects action (default-project create)", () => {
  it("forwards POST to the backend /api/projects endpoint through auth-proxy, carrying the credential AND the JSON body", async () => {
    const captured = stubFetch(new Response("{}", { status: 201 }));

    await action({
      request: postRequest({ name: "My First Project" }),
      params: {},
      context: {},
    } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/projects`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "My First Project",
    });
  });

  it("forwards the upstream 201 status AND body through (the driver reads the created project snapshot)", async () => {
    stubFetch(
      new Response('{"data":{"type":"projects","id":"proj-1"}}', {
        status: 201,
      }),
    );

    const res = await action({
      request: postRequest({ name: "My First Project" }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(201);
    expect(await res.text()).toBe('{"data":{"type":"projects","id":"proj-1"}}');
  });
});
