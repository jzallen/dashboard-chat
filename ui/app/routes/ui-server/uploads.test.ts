// @vitest-environment node
// Resource-route action: ui-server-side code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./uploads";

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

/** A multipart upload Request as the browser's FormData POST produces it. */
function uploadRequest(): Request {
  const form = new FormData();
  form.append("file", new File(["a,b\n1,2\n"], "orders.csv", { type: "text/csv" }));
  form.append("project_id", "p1");
  return new Request("http://localhost/ui-server/uploads", {
    method: "POST",
    headers: new Headers({ cookie: "session=1", authorization: "Bearer user-jwt" }),
    body: form,
  });
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("/ui-server/uploads resource route (one-step dataset upload)", () => {
  it("forwards the multipart POST to the backend /api/uploads through auth-proxy, carrying the credential and the multipart body", async () => {
    const captured = stubFetch(
      new Response('{"data":{"id":"ds.x"}}', { status: 201 }),
    );

    await action({ request: uploadRequest(), params: {}, context: {} } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/api/uploads`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer user-jwt",
    );
    // The multipart boundary is preserved so the backend can parse the file.
    expect(new Headers(init.headers).get("content-type")).toMatch(
      /^multipart\/form-data; boundary=/,
    );
    // The raw file bytes are forwarded (not dropped/corrupted).
    expect((init.body as ArrayBuffer).byteLength).toBeGreaterThan(0);
  });

  it("passes the created-dataset body + status straight through", async () => {
    stubFetch(new Response('{"data":{"id":"ds.x"}}', { status: 201 }));

    const res = await action({
      request: uploadRequest(),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(201);
    expect(JSON.parse(await res.text())).toEqual({ data: { id: "ds.x" } });
  });

  it("passes a non-2xx upstream through unchanged WITHOUT redirecting (caller surfaces it)", async () => {
    stubFetch(new Response("nope", { status: 500 }));

    const res = await action({
      request: uploadRequest(),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(500);
    expect(res.headers.get("location")).toBeNull();
  });
});
