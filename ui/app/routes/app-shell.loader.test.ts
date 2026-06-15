// @vitest-environment happy-dom
//
// app-shell server `loader` — the S2/DC-9 seam: org-global reads (projects +
// org settings) move OFF the client `clientLoader`/`refreshOrgGlobal` ONTO a
// server `loader` that reaches the backend through S1's `apiFetch` cookie→Bearer
// hop, so the data is serialized into the initial document payload.
//
// Env note (reconciles DC-26's "node env, mirroring api-client.test.ts"):
// `app-shell.tsx` is a framework-mode ROUTE module — importing its `loader`
// pulls the route's React component tree (providers, Topbar, …). The existing
// `app-shell.test.tsx` already proves happy-dom is the env that imports this
// module cleanly, so the loader unit runs under happy-dom too. The network is
// still stubbed at the global-`fetch` port exactly like `api-client.test.ts`.
//
// One `it(...)` per AC checkbox on DC-26:
//   AC1 — fetches /api/projects + /api/orgs/me via apiFetch (forwarding the
//         inbound credential) and returns the mapped { projects, org }.   [RED]
//   AC2 — a 401 upstream → throws redirect("/login") (decision #5).        [RED]
//   AC3 — shouldRevalidate() stays false so org-global isn't re-fetched
//         on in-app navigation (decision #2).                  [green: preserved]
import type { LoaderFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader, shouldRevalidate } from "./app-shell";

/** The loader only reads `request`; cast a minimal args object for the call. */
function loaderArgs(request: Request): LoaderFunctionArgs {
  return { request } as LoaderFunctionArgs;
}

const AUTH_PROXY_URL = "http://auth-proxy.test";

type Captured = { url: string; init: RequestInit };

/** Stub global fetch with a per-URL handler; returns the captured calls. */
function stubFetch(handler: (url: string) => Response): () => Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      calls.push({ url, init: init ?? {} });
      return handler(url);
    },
  );
  return () => calls;
}

/** A JSON:API list envelope: `{ data: [{ type, id, attributes }] }`. */
function listEnvelope(
  type: string,
  resources: { id: string; attributes: Record<string, unknown> }[],
): Response {
  const data = resources.map((r) => ({ type, id: r.id, attributes: r.attributes }));
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** A JSON:API single envelope: `{ data: { type, id, attributes } }`. */
function singleEnvelope(
  type: string,
  id: string,
  attributes: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify({ data: { type, id, attributes } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const orgAttributes = {
  name: "Acme",
  slug: "acme",
  region: "us-east-1",
  plan: "pro",
  seats: 10,
  used_seats: 3,
  created_at: "2026-01-01T00:00:00Z",
  members: [{ name: "Ada", email: "ada@acme.test", role: "admin" }],
  defaults: { engine: "duckdb", materialization: "view", model_prefix: "stg_" },
};

/** An authenticated inbound request carrying the user's session credential. */
function authedRequest(): Request {
  return new Request("http://localhost/", {
    headers: new Headers({
      cookie: "auth_token=abc",
      authorization: "Bearer user-jwt",
    }),
  });
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("app-shell loader — org-global reads via the server /api hop", () => {
  it("AC1: fetches /api/projects + /api/orgs/me via apiFetch, forwards the credential, and returns the mapped { projects, org }", async () => {
    const calls = stubFetch((url) => {
      if (url.endsWith("/api/projects")) {
        return listEnvelope("projects", [
          {
            id: "p1",
            attributes: {
              name: "Alpha",
              description: "first",
              datasets: [{}, {}],
            },
          },
        ]);
      }
      if (url.endsWith("/api/orgs/me")) {
        return singleEnvelope("orgs", "o1", orgAttributes);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await loader(loaderArgs(authedRequest()));

    const urls = calls().map((c) => c.url);
    expect(urls).toContain(`${AUTH_PROXY_URL}/api/projects`);
    expect(urls).toContain(`${AUTH_PROXY_URL}/api/orgs/me`);
    // The inbound user credential is forwarded server-side (no browser hop).
    for (const { init } of calls()) {
      expect(new Headers(init.headers).get("cookie")).toBe("auth_token=abc");
    }

    expect(result).toEqual({
      projects: [
        { id: "p1", name: "Alpha", desc: "first", datasets: 2, models: 0 },
      ],
      org: {
        name: "Acme",
        slug: "acme",
        region: "us-east-1",
        plan: "pro",
        seats: 10,
        usedSeats: 3,
        created: "2026-01-01T00:00:00Z",
        members: [{ name: "Ada", email: "ada@acme.test", role: "admin" }],
        defaults: {
          engine: "duckdb",
          materialization: "view",
          modelPrefix: "stg_",
        },
      },
    });
  });

  it("AC2: a 401 upstream throws redirect('/login') instead of surfacing a client 401 (decision #5)", async () => {
    stubFetch(() => new Response("Unauthorized", { status: 401 }));

    let thrown: unknown;
    try {
      await loader(loaderArgs(authedRequest()));
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
  });

  it("AC3: shouldRevalidate() returns false so org-global data is not re-fetched on navigation (decision #2)", () => {
    expect(shouldRevalidate()).toBe(false);
  });
});
