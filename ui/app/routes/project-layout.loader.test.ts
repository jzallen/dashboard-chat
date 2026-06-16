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

/**
 * Run the loader and return the value it THREW — the loader is the unit under
 * test, so the failure-path tests assert against its actual thrown value (a
 * redirect `Response`, or a read `Error`), not a normalized stand-in. Fails the
 * test if the loader resolves instead of throwing.
 */
async function loaderThrew(projectId: string): Promise<unknown> {
  try {
    await loader(loaderArgs(authedRequest(), projectId));
  } catch (err) {
    return err;
  }
  throw new Error("expected the loader to throw, but it resolved a catalog");
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

    // The assembled scoped payload, as one aggregate: the lineage graph (node ids
    // + derived edges) from sources/datasets/views/reports, sessions → chats (and
    // recents — the same first page here), the dbt manifest → files, and audit
    // folded by node id. Exact per-node field shapes and the relative-time `when`
    // are pinned by the mapper unit tests, so this projects to the assembly the
    // loader is responsible for rather than re-asserting the mappers.
    expect({
      projectId: result.projectId,
      nodeIds: Object.keys(result.nodes).sort(),
      edges: result.edges,
      chatTitles: result.chats.map((c) => c.title),
      recentTitles: result.recents.map((c) => c.title),
      dbtPaths: result.dbtFiles.map((f) => f.path),
      auditNodeIds: Object.keys(result.audit),
    }).toEqual({
      projectId: "p1",
      nodeIds: ["d-p1", "r-p1", "s-p1", "v-p1"],
      edges: [
        ["s-p1", "d-p1"],
        ["d-p1", "v-p1"],
        ["v-p1", "r-p1"],
      ],
      chatTitles: ["Chat p1"],
      recentTitles: ["Chat p1"],
      dbtPaths: ["models/stg_p1.sql"],
      auditNodeIds: ["d-p1"],
    });
  });

  // AC2 — at the loader level the only unit-testable surface is the revalidation
  // predicate RRv7 consults (RRv7 itself is the caller — no first-party code calls
  // shouldRevalidate). Revalidate iff the path project changed, so a project switch
  // re-scopes but same-project navigation (a `?view=` toggle, a nested route) does
  // not needlessly re-fetch. The actual re-run/re-seed on a switch is the router's
  // behaviour, proven through the caller by a navigation integration test once the
  // loader is real (DC-37); per-pid data scoping is covered by AC1.
  it("revalidates when the path project changes", () => {
    expect(
      shouldRevalidate({
        currentParams: { projectId: "p1" },
        nextParams: { projectId: "p2" },
      }),
    ).toBe(true);
  });

  it("does not revalidate when the path project is unchanged", () => {
    expect(
      shouldRevalidate({
        currentParams: { projectId: "p1" },
        nextParams: { projectId: "p1" },
      }),
    ).toBe(false);
  });

  // AC3 — a non-401 read failure surfaces on the ErrorBoundary, not as a silent
  // empty catalog: the loader rejects (no resolved partial catalog) and does NOT
  // mask the failure as a /login redirect (that's reserved for the 401 case below).
  it("rejects a non-401 read failure rather than resolving a partial catalog", async () => {
    const calls = stubFetch((url) =>
      url.endsWith("/api/projects/p1/audit")
        ? new Response("boom", { status: 500 })
        : listEnvelope("any", []),
    );

    // The loader attempts the reads, and a non-401 failure among them aborts to
    // the ErrorBoundary: it throws (no resolved partial catalog) having actually
    // fetched, and what it throws is NOT a /login redirect (that's the 401 case).
    const thrown = await loaderThrew("p1");
    expect({
      attemptedReads: calls().length > 0,
      threwRedirect: thrown instanceof Response && thrown.status === 302,
    }).toEqual({ attemptedReads: true, threwRedirect: false });
  });

  // AC3 — a 401 is the unauthenticated signal, turned into a /login redirect
  // (mirroring the app-shell loader), not surfaced as a read error.
  it("redirects to /login when a project-scoped read returns 401", async () => {
    stubFetch(() => new Response("Unauthorized", { status: 401 }));

    // The loader throws the redirect Response itself (RRv7's `redirect("/login")`),
    // so assert against that thrown value's real status + Location.
    const thrown = await loaderThrew("p1");
    expect(
      thrown instanceof Response
        ? { status: thrown.status, location: thrown.headers.get("Location") }
        : thrown,
    ).toEqual({ status: 302, location: "/login" });
  });
});
