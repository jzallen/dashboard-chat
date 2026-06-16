// @vitest-environment node
//
// The /project/:projectId server loader fetches the project-scoped catalog reads
// (sources, datasets, views, reports, sessions, dbt manifest, audit) through the
// server /api client, maps them, and returns them for the initial document —
// redirecting to /login on an unauthenticated response and throwing (→
// ErrorBoundary) on any other backend failure.
//
// Node env (not happy-dom): the loader forwards the inbound `cookie`, a forbidden
// header a browser environment strips from a Request — only node's undici
// preserves it, matching the server runtime. The network is stubbed at the global
// `fetch` boundary, mirroring app-shell.loader.test.ts.
import type { LoaderFunctionArgs } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loader, shouldRevalidate } from "./project-layout";

/** Build the loader args for a project route scoped to `projectId`. */
function loaderArgs(request: Request, projectId: string): LoaderFunctionArgs {
  return { request, params: { projectId } } as unknown as LoaderFunctionArgs;
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
  const data = resources.map((r) => ({
    type,
    id: r.id,
    attributes: r.attributes,
  }));
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

/** An authenticated inbound request carrying the user's session credential. */
function authedRequest(): Request {
  return new Request("http://localhost/project/p1", {
    headers: new Headers({
      cookie: "auth_token=abc",
      authorization: "Bearer user-jwt",
    }),
  });
}

/**
 * Route the project-scoped endpoints for project `pid` to envelope fixtures, so
 * the loader's reads resolve to a one-of-each catalog. The lineage chain is
 * source s→dataset d→view v→report r; one session, one dbt file, one audit row.
 */
function stubProjectReads(pid: string): () => Captured[] {
  return stubFetch((url) => {
    if (url.endsWith(`/api/sources?project_id=${pid}`)) {
      return listEnvelope("sources", [
        { id: `s-${pid}`, attributes: { name: "Orders" } },
      ]);
    }
    if (url.endsWith(`/api/datasets?project_id=${pid}`)) {
      return listEnvelope("datasets", [
        { id: `d-${pid}`, attributes: { name: "orders.csv", source_id: `s-${pid}` } },
      ]);
    }
    if (url.endsWith(`/api/projects/${pid}/views`)) {
      return listEnvelope("views", [
        {
          id: `v-${pid}`,
          attributes: { name: "Enriched", source_refs: [{ id: `d-${pid}`, type: "dataset" }] },
        },
      ]);
    }
    if (url.endsWith(`/api/projects/${pid}/reports`)) {
      return listEnvelope("reports", [
        {
          id: `r-${pid}`,
          attributes: { name: "Summary", source_refs: [{ id: `v-${pid}`, type: "view" }] },
        },
      ]);
    }
    if (url.endsWith(`/api/projects/${pid}/sessions`)) {
      return listEnvelope("sessions", [
        {
          id: `sess-${pid}`,
          attributes: {
            title: `Chat ${pid}`,
            active_dataset_id: `d-${pid}`,
            last_active_at: "2026-06-16T00:00:00Z",
            created_at: "2026-06-15T00:00:00Z",
          },
        },
      ]);
    }
    if (url.endsWith(`/api/projects/${pid}/export/dbt/manifest`)) {
      return singleEnvelope("manifests", `m-${pid}`, {
        files: [{ path: `models/stg_${pid}.sql`, layer: "staging" }],
      });
    }
    if (url.endsWith(`/api/projects/${pid}/audit`)) {
      return listEnvelope("audit", [
        {
          id: `a-${pid}`,
          attributes: {
            node_id: `d-${pid}`,
            node_kind: "dataset",
            tool: "infer_schema",
            say: "inferred the schema",
            tag: "create",
          },
        },
      ]);
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  process.env.AUTH_PROXY_URL = AUTH_PROXY_URL;
});
afterEach(() => vi.unstubAllGlobals());

describe("project-layout loader — project-scoped reads via the server /api hop", () => {
  // AC1
  it("fetches each project-scoped endpoint scoped to the path projectId, forwards the inbound credential, and returns the mapped ProjectScopedData", async () => {
    const calls = stubProjectReads("p1");

    const result = await loader(loaderArgs(authedRequest(), "p1"));

    // Exactly the project-scoped reads, each scoped to the path projectId — no
    // more (over-fetch), no fewer. Order is NOT part of the contract: these are
    // independent reads fired in parallel, so compare the sets order-independently
    // rather than pinning the parallel-fetch sequence.
    const expectedUrls = [
      `${AUTH_PROXY_URL}/api/sources?project_id=p1`,
      `${AUTH_PROXY_URL}/api/datasets?project_id=p1`,
      `${AUTH_PROXY_URL}/api/projects/p1/views`,
      `${AUTH_PROXY_URL}/api/projects/p1/reports`,
      `${AUTH_PROXY_URL}/api/projects/p1/sessions`,
      `${AUTH_PROXY_URL}/api/projects/p1/export/dbt/manifest`,
      `${AUTH_PROXY_URL}/api/projects/p1/audit`,
    ];
    const urls = calls().map((c) => c.url);
    expect([...urls].sort()).toEqual([...expectedUrls].sort());

    // The inbound user credential is forwarded server-side (no browser hop).
    for (const { init } of calls()) {
      expect(new Headers(init.headers).get("cookie")).toBe("auth_token=abc");
    }

    expect(result.projectId).toBe("p1");
    // The lineage graph is derived from sources/datasets/views/reports.
    expect(Object.keys(result.nodes).sort()).toEqual(["d-p1", "r-p1", "s-p1", "v-p1"]);
    expect(result.edges.length).toBeGreaterThan(0);
    // Sessions → chats/recents; manifest → dbt files; audit folded by node id.
    expect(result.chats.map((c) => c.title)).toEqual(["Chat p1"]);
    expect(result.recents.map((c) => c.title)).toEqual(["Chat p1"]);
    expect(result.dbtFiles.map((f) => f.path)).toEqual(["models/stg_p1.sql"]);
    expect(result.audit["d-p1"]).toHaveLength(1);
  });

  // AC2
  it("swaps to the new project's scope when projectId changes", async () => {
    expect(
      shouldRevalidate({
        currentParams: { projectId: "p1" },
        nextParams: { projectId: "p2" },
      }),
    ).toBe(true);
    expect(
      shouldRevalidate({
        currentParams: { projectId: "p1" },
        nextParams: { projectId: "p1" },
      }),
    ).toBe(false);

    stubProjectReads("p1");
    const first = await loader(loaderArgs(authedRequest(), "p1"));
    expect(first.projectId).toBe("p1");

    vi.unstubAllGlobals();
    stubProjectReads("p2");
    const second = await loader(loaderArgs(authedRequest(), "p2"));

    // On a new project selection the prior scope is ejected and the new one
    // replaces it wholesale: the re-run is a different payload that identifies as
    // p2 and carries no p1-scoped id in ANY field (the fixtures namespace every id
    // by pid, so any leakage would surface a "p1" substring). Per-field content of
    // the new scope is already covered by the AC1 test — here we test the swap.
    expect(second.projectId).toBe("p2");
    expect(second).not.toEqual(first);
    expect(JSON.stringify(second)).not.toContain("p1");
  });

  // AC3
  it("throws (→ ErrorBoundary) on a non-401 read failure and redirects to /login on a 401 — never a silent empty catalog", async () => {
    // A non-401 backend failure on one read must reject the whole loader rather
    // than resolve a partial/empty catalog.
    stubFetch((url) => {
      if (url.endsWith("/api/projects/p1/audit")) {
        return new Response("boom", { status: 500 });
      }
      return listEnvelope("any", []);
    });

    let thrown: unknown;
    try {
      await loader(loaderArgs(authedRequest(), "p1"));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    // Not a redirect: a read failure surfaces the error boundary, not /login.
    expect(
      thrown instanceof Response && thrown.status === 302,
    ).toBe(false);

    // A 401 is the unauthenticated signal → redirect to /login (as in app-shell).
    vi.unstubAllGlobals();
    stubFetch(() => new Response("Unauthorized", { status: 401 }));

    let redirected: unknown;
    try {
      await loader(loaderArgs(authedRequest(), "p1"));
    } catch (err) {
      redirected = err;
    }
    expect(redirected).toBeInstanceOf(Response);
    const response = redirected as Response;
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/login");
  });
});
