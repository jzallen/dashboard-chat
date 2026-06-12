// @vitest-environment node
// Resource-route action: server-side BFF code, tested under node's undici.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { action } from "./bff-chat";

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

function chatRequest(body: unknown): Request {
  return new Request("http://localhost/bff/chat", {
    method: "POST",
    headers: new Headers({
      cookie: "session=1",
      "content-type": "application/json",
    }),
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("/bff/chat resource route (agent SSE relay)", () => {
  it("relays POST /worker/chat server-side, forwarding the credential and body", async () => {
    const captured = stubFetch(
      new Response('data: {"type":"finish"}\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const payload = { messages: [{ role: "user", content: "trim city" }] };

    await action({ request: chatRequest(payload), params: {}, context: {} } as never);

    const { url, init } = captured();
    expect(url).toBe(`${AUTH_PROXY_URL}/worker/chat`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("cookie")).toBe("session=1");
    expect(JSON.parse(init.body as string)).toEqual(payload);
  });

  it("pipes the upstream SSE body straight back un-buffered (no server-side parse)", async () => {
    const sse =
      'data: {"type":"text-delta","delta":"hi"}\n\ndata: [DONE]\n\n';
    const upstream = new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
    stubFetch(upstream);

    const res = await action({
      request: chatRequest({ messages: [] }),
      params: {},
      context: {},
    } as never);

    // Passthrough: status + SSE content-type preserved, body not consumed by the
    // server (the action returns before draining — frame parsing is client-side).
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(upstream.bodyUsed).toBe(false);
    expect(await res.text()).toBe(sse);
  });

  it("passes a non-2xx upstream through unchanged (rollback-friendly)", async () => {
    stubFetch(new Response("nope", { status: 401 }));

    const res = await action({
      request: chatRequest({ messages: [] }),
      params: {},
      context: {},
    } as never);

    expect(res.status).toBe(401);
  });
});
