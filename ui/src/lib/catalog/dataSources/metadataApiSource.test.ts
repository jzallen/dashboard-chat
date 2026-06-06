import { afterEach, describe, expect, it, vi } from "vitest";

import { metadataApiSource } from "./metadataApiSource";

/**
 * A URL-dispatching fetch mock. Slice 2 fetches four distinct URLs (projects +
 * the three lineage lists), so a single-body stub is insufficient — each path
 * resolves its own envelope body. Any unmatched path 404s (so a typo in a URL
 * surfaces as a rejection, not a silent pass).
 */
function stubFetch(routes: Record<string, unknown>, ok = true) {
  const fetchMock = vi.fn(async (url: string) => {
    // Prefer an exact full-URL match (so query-scoped routes like
    // `/api/datasets?project_id=p2` are distinguishable); fall back to a
    // path-only match for routes registered without a query string.
    const path = url.split("?")[0];
    const exact = Object.keys(routes).find((route) => route === url);
    const match =
      exact ??
      Object.keys(routes).find(
        (route) => !route.includes("?") && path === route.split("?")[0],
      );
    if (!ok) {
      return { ok: false, status: 500, json: async () => ({ detail: "boom" }) };
    }
    if (match === undefined) {
      return { ok: false, status: 404, json: async () => ({ detail: url }) };
    }
    return { ok: true, status: 200, json: async () => routes[match] };
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** A single-body fetch stub (project-only tests, slice-1 style). */
function stubProjects(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

const PROJECTS = "/api/projects";
const DATASETS = "/api/datasets";
const VIEWS = "/api/projects/p1/views";
const REPORTS = "/api/projects/p1/reports";

const LINEAGE_ROUTES = {
  [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
  [DATASETS]: {
    data: [
      {
        id: "d1",
        name: "customers",
        schema_config: { fields: { email: { type: "text" } } },
        staging_sql: "SELECT 1",
        row_count: 3,
      },
    ],
  },
  [VIEWS]: {
    data: [
      {
        id: "v1",
        name: "active",
        sql_definition: "SELECT 1",
        source_refs: [{ id: "d1", type: "dataset" }],
      },
    ],
  },
  [REPORTS]: {
    data: [
      {
        id: "r1",
        name: "revenue",
        sql_definition: "SELECT 1",
        source_refs: [{ id: "v1", type: "view" }],
      },
    ],
  },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("metadataApiSource — backend project reads", () => {
  it("maps a backend ProjectResponse to ProjectSummary and unwraps the envelope", async () => {
    stubProjects({
      data: [
        {
          id: "p1",
          name: "Acme Warehouse",
          description: "seeded",
          datasets: [{ id: "d1" }, { id: "d2" }],
        },
      ],
    });
    const source = metadataApiSource({ getToken: () => "tok" });
    const projects = await source.getProjects!();
    expect(projects).toEqual([
      { id: "p1", name: "Acme Warehouse", desc: "seeded", datasets: 2, models: 0 },
    ]);
  });

  it("defaults missing description to '' and missing datasets to 0", async () => {
    stubProjects({ data: [{ id: "p2", name: "Bare" }] });
    const source = metadataApiSource({ getToken: () => "tok" });
    const projects = await source.getProjects!();
    expect(projects[0]).toEqual({
      id: "p2",
      name: "Bare",
      desc: "",
      datasets: 0,
      models: 0,
    });
  });

  it("sends the Bearer token on the request", async () => {
    const fetchMock = stubProjects({ data: [{ id: "p1", name: "X" }] });
    const source = metadataApiSource({ getToken: () => "secret-token" });
    await source.getProjects!();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const init = call[1];
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
  });

  it("resolves [] on an empty project list (empty backend → empty picker, not fixtures)", async () => {
    stubProjects({ data: [] });
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getProjects!()).resolves.toEqual([]);
  });

  it("rejects on a non-2xx response", async () => {
    stubProjects({ detail: "boom" }, false);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getProjects!()).rejects.toThrow();
  });

  it("getCurrentProject falls back to the first project when no scope is injected", async () => {
    stubProjects({
      data: [
        { id: "p1", name: "Acme", description: "first" },
        { id: "p2", name: "Other" },
      ],
    });
    const source = metadataApiSource({ getToken: () => "tok" });
    const current = await source.getCurrentProject!();
    expect(current).toEqual({ id: "p1", name: "Acme", description: "first" });
  });

  it("getCurrentProject returns the SCOPED project, not the first", async () => {
    stubProjects({
      data: [
        { id: "p1", name: "Acme", description: "first" },
        { id: "p2", name: "Other", description: "second" },
      ],
    });
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p2",
    });
    const current = await source.getCurrentProject!();
    expect(current).toEqual({ id: "p2", name: "Other", description: "second" });
  });

  it("getCurrentProject throws when there is no first project", async () => {
    stubProjects({ data: [] });
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getCurrentProject!()).rejects.toThrow();
  });
});

describe("metadataApiSource — lineage core (getNodes/getEdges/getAudit)", () => {
  const countPaths = (fetchMock: ReturnType<typeof vi.fn>) => {
    const counts: Record<string, number> = {};
    for (const call of fetchMock.mock.calls) {
      const path = (call[0] as string).split("?")[0];
      counts[path] = (counts[path] ?? 0) + 1;
    }
    return counts;
  };

  it("fetches the three lineage URLs after resolving the project id, and returns mapped nodes", async () => {
    const fetchMock = stubFetch(LINEAGE_ROUTES);
    const source = metadataApiSource({ getToken: () => "tok" });
    const nodes = await source.getNodes!();

    const paths = fetchMock.mock.calls.map((c) => (c[0] as string).split("?")[0]);
    expect(paths).toContain(PROJECTS);
    expect(paths).toContain(DATASETS);
    expect(paths).toContain(VIEWS);
    expect(paths).toContain(REPORTS);

    expect(Object.keys(nodes).sort()).toEqual(["d1", "r1", "v1"]);
    expect(nodes.d1.layer).toBe("staging");
    expect(nodes.v1.layer).toBe("intermediate");
    expect(nodes.r1.layer).toBe("mart");
  });

  it("hits /api/datasets with the resolved project_id query", async () => {
    const fetchMock = stubFetch(LINEAGE_ROUTES);
    const source = metadataApiSource({ getToken: () => "tok" });
    await source.getNodes!();
    const datasetCall = fetchMock.mock.calls.find((c) =>
      (c[0] as string).startsWith(DATASETS),
    );
    expect(datasetCall?.[0]).toBe("/api/datasets?project_id=p1");
  });

  it("derives edges [source_ref.id, entity.id]", async () => {
    stubFetch(LINEAGE_ROUTES);
    const source = metadataApiSource({ getToken: () => "tok" });
    const edges = await source.getEdges!();
    expect(edges).toContainEqual(["d1", "v1"]);
    expect(edges).toContainEqual(["v1", "r1"]);
  });

  it("getNodes + getEdges trigger only ONE round of the three lineage fetches (memoized)", async () => {
    const fetchMock = stubFetch(LINEAGE_ROUTES);
    const source = metadataApiSource({ getToken: () => "tok" });
    await Promise.all([source.getNodes!(), source.getEdges!()]);

    const counts = countPaths(fetchMock);
    expect(counts[DATASETS]).toBe(1);
    expect(counts[VIEWS]).toBe(1);
    expect(counts[REPORTS]).toBe(1);
  });

  it("getProjects + getNodes hit /api/projects exactly once (projectsPromise memo)", async () => {
    const fetchMock = stubFetch(LINEAGE_ROUTES);
    const source = metadataApiSource({ getToken: () => "tok" });
    await Promise.all([source.getProjects!(), source.getNodes!()]);
    expect(countPaths(fetchMock)[PROJECTS]).toBe(1);
  });

  it("getAudit resolves {} with no fetch", async () => {
    const fetchMock = stubFetch(LINEAGE_ROUTES);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getAudit!()).resolves.toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("getNodes resolves {} when the backend is legitimately empty (does NOT reject)", async () => {
    stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
      [DATASETS]: { data: [] },
      [VIEWS]: { data: [] },
      [REPORTS]: { data: [] },
    });
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getNodes!()).resolves.toEqual({});
  });

  it("getNodes rejects when a lineage fetch is non-2xx", async () => {
    stubFetch(LINEAGE_ROUTES, false);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getNodes!()).rejects.toThrow();
  });

  it("sends the Bearer token on lineage requests", async () => {
    const fetchMock = stubFetch(LINEAGE_ROUTES);
    const source = metadataApiSource({ getToken: () => "secret-token" });
    await source.getNodes!();
    const datasetCall = fetchMock.mock.calls.find((c) =>
      (c[0] as string).startsWith(DATASETS),
    ) as unknown as [string, RequestInit];
    expect((datasetCall[1].headers as Record<string, string>).Authorization).toBe(
      "Bearer secret-token",
    );
  });
});

describe("metadataApiSource — project-scoped lineage (project-in-path)", () => {
  const countPaths = (fetchMock: ReturnType<typeof vi.fn>) => {
    const counts: Record<string, number> = {};
    for (const call of fetchMock.mock.calls) {
      const path = (call[0] as string).split("?")[0];
      counts[path] = (counts[path] ?? 0) + 1;
    }
    return counts;
  };

  /** Lineage routes for two coexisting projects, p1 and p2. */
  const TWO_PROJECT_ROUTES = {
    [PROJECTS]: { data: [{ id: "p1", name: "Acme" }, { id: "p2", name: "Beta" }] },
    "/api/datasets?project_id=p1": {
      data: [
        {
          id: "d1",
          name: "customers",
          schema_config: { fields: {} },
          staging_sql: "SELECT 1",
          row_count: 1,
        },
      ],
    },
    "/api/projects/p1/views": { data: [] },
    "/api/projects/p1/reports": { data: [] },
    "/api/datasets?project_id=p2": {
      data: [
        {
          id: "d2",
          name: "orders",
          schema_config: { fields: {} },
          staging_sql: "SELECT 1",
          row_count: 1,
        },
      ],
    },
    "/api/projects/p2/views": {
      data: [
        {
          id: "v2",
          name: "active_orders",
          sql_definition: "SELECT 1",
          source_refs: [{ id: "d2", type: "dataset" }],
        },
      ],
    },
    "/api/projects/p2/reports": { data: [] },
  };

  it("scopes the lineage bundle to the injected project id (targets p2's URLs)", async () => {
    const fetchMock = stubFetch(TWO_PROJECT_ROUTES);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p2",
    });
    const nodes = await source.getNodes!();

    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain("/api/datasets?project_id=p2");
    expect(urls).toContain("/api/projects/p2/views");
    expect(urls).toContain("/api/projects/p2/reports");
    // …and NOT p1's lineage URLs.
    expect(urls).not.toContain("/api/datasets?project_id=p1");

    // p2's graph: dataset d2 + view v2 (p1's d1 is absent).
    expect(Object.keys(nodes).sort()).toEqual(["d2", "v2"]);
  });

  it("memoizes per pid: scope p1 → p2 → p1 fetches p1's datasets only once", async () => {
    let pid: string | undefined = "p1";
    const fetchMock = stubFetch(TWO_PROJECT_ROUTES);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => pid,
    });

    await source.getNodes!(); // p1
    pid = "p2";
    await source.getNodes!(); // p2
    pid = "p1";
    await source.getNodes!(); // p1 again — must reuse the memoized bundle

    const counts = countPaths(fetchMock);
    expect(counts["/api/datasets"]).toBe(2); // p1 once + p2 once, not 3
  });
});
