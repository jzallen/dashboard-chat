import { afterEach, describe, expect, it, vi } from "vitest";

import { metadataApiSource } from "./metadataApiSource";

/**
 * A URL-dispatching fetch mock. The lineage reads hit four distinct URLs
 * (projects + the three lineage lists), so a single-body stub is insufficient —
 * each path resolves its own envelope body. Any unmatched path 404s (so a typo in
 * a URL surfaces as a rejection, not a silent pass).
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

/** A single-body fetch stub for project-only tests. */
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

  it("sends credentials:'include' (cookie session) and no Authorization on the request", async () => {
    const fetchMock = stubProjects({ data: [{ id: "p1", name: "X" }] });
    // A non-null token is injected to prove the dep is a dead seam: no header.
    const source = metadataApiSource({ getToken: () => "secret-token" });
    await source.getProjects!();
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const init = call[1];
    expect(init.credentials).toBe("include");
    expect(
      (init.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
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

describe("metadataApiSource — invalidateOrgGlobal (org-global memo invalidation)", () => {
  it("getProjects re-fetches after invalidateOrgGlobal() and observes the CHANGED backend list", async () => {
    // The backend list changes between fetches (onboarding creates the first
    // project): the memo must be droppable so the change is observable.
    const bodies = [
      { data: [] }, // pre-onboarding: legitimately empty backend
      { data: [{ id: "p1", name: "Acme" }] }, // post-onboarding: project exists
    ];
    let call = 0;
    const fetchMock = vi.fn(async () => {
      const body = bodies[Math.min(call++, bodies.length - 1)];
      return { ok: true, status: 200, json: async () => body };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const source = metadataApiSource({ getToken: () => "tok" });

    // First read latches the empty list (memoized — second read shares it).
    await expect(source.getProjects!()).resolves.toEqual([]);
    await expect(source.getProjects!()).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    source.invalidateOrgGlobal!();

    // The next read RE-FETCHES and observes the new backend state.
    const after = await source.getProjects!();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(after).toEqual([
      { id: "p1", name: "Acme", desc: "", datasets: 0, models: 0 },
    ]);
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

  it("sends credentials:'include' and no Authorization on lineage requests", async () => {
    const fetchMock = stubFetch(LINEAGE_ROUTES);
    const source = metadataApiSource({ getToken: () => "secret-token" });
    await source.getNodes!();
    const datasetCall = fetchMock.mock.calls.find((c) =>
      (c[0] as string).startsWith(DATASETS),
    ) as unknown as [string, RequestInit];
    expect(datasetCall[1].credentials).toBe("include");
    expect(
      (datasetCall[1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();
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

describe("metadataApiSource — org settings (getOrg)", () => {
  const ORG = "/api/orgs/me";

  const ORG_BODY = {
    data: {
      type: "organizations",
      id: "dev-org-001",
      attributes: {
        name: "Acme",
        slug: "acme",
        region: "us-east-1",
        plan: "free",
        seats: 5,
        used_seats: 1,
        created_at: "2026-01-01T00:00:00Z",
        members: [{ name: "Dev User", email: "dev@example.com", role: "owner" }],
        defaults: {
          engine: "duckdb",
          materialization: "view",
          model_prefix: "acme_",
        },
      },
    },
  };

  it("fetches /api/orgs/me and maps snake_case attributes to the OrgSettings camelCase shape", async () => {
    const fetchMock = stubFetch({ [ORG]: ORG_BODY });
    const source = metadataApiSource({ getToken: () => "tok" });

    const org = await source.getOrg!();

    expect(fetchMock.mock.calls.map((c) => c[0] as string)).toContain(ORG);
    expect(org).toEqual({
      name: "Acme",
      slug: "acme",
      region: "us-east-1",
      plan: "free",
      seats: 5,
      usedSeats: 1,
      created: "2026-01-01T00:00:00Z",
      members: [{ name: "Dev User", email: "dev@example.com", role: "owner" }],
      defaults: {
        engine: "duckdb",
        materialization: "view",
        modelPrefix: "acme_",
      },
    });
  });

  it("sends credentials:'include' and no Authorization on the org request", async () => {
    const fetchMock = stubFetch({ [ORG]: ORG_BODY });
    const source = metadataApiSource({ getToken: () => "secret-token" });
    await source.getOrg!();
    const orgCall = fetchMock.mock.calls.find(
      (c) => (c[0] as string) === ORG,
    ) as unknown as [string, RequestInit];
    expect(orgCall[1].credentials).toBe("include");
    expect(
      (orgCall[1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("rejects on a non-2xx org response (fixtures kept upstream)", async () => {
    stubFetch({ [ORG]: ORG_BODY }, false);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getOrg!()).rejects.toThrow();
  });
});

describe("metadataApiSource — dbt manifest (getDbtFiles)", () => {
  const MANIFEST_P1 = "/api/projects/p1/export/dbt/manifest";

  const MANIFEST_BODY = {
    data: {
      type: "dbt-manifests",
      id: "p1",
      attributes: {
        project_name: "acme_analytics",
        layer_counts: { staging: 1, intermediate: 1, mart: 1, config: 4 },
        files: [
          { path: "dbt_project.yml", layer: "config" },
          {
            path: "models/staging/stg_leads.sql",
            layer: "staging",
            ref: "stg_leads",
          },
          {
            path: "models/intermediate/int_active.sql",
            layer: "intermediate",
            ref: "int_active",
          },
          {
            path: "models/marts/sales/fct_revenue.sql",
            layer: "mart",
            ref: "fct_revenue",
          },
        ],
      },
    },
  };

  it("fetches the project-scoped manifest and maps files[] to DbtFile[]", async () => {
    const fetchMock = stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
      [MANIFEST_P1]: MANIFEST_BODY,
    });
    const source = metadataApiSource({ getToken: () => "tok" });

    const files = await source.getDbtFiles!();

    expect(fetchMock.mock.calls.map((c) => c[0] as string)).toContain(
      MANIFEST_P1,
    );
    expect(files).toEqual([
      { path: "dbt_project.yml", layer: "config", ref: undefined },
      { path: "models/staging/stg_leads.sql", layer: "staging", ref: "stg_leads" },
      {
        path: "models/intermediate/int_active.sql",
        layer: "intermediate",
        ref: "int_active",
      },
      {
        path: "models/marts/sales/fct_revenue.sql",
        layer: "mart",
        ref: "fct_revenue",
      },
    ]);
  });

  it("scopes the manifest URL to the injected project id (p2)", async () => {
    const fetchMock = stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }, { id: "p2", name: "Beta" }] },
      "/api/projects/p2/export/dbt/manifest": {
        data: { type: "dbt-manifests", id: "p2", attributes: { files: [] } },
      },
    });
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p2",
    });
    await source.getDbtFiles!();
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain("/api/projects/p2/export/dbt/manifest");
    expect(urls).not.toContain("/api/projects/p1/export/dbt/manifest");
  });

  it("resolves the (possibly empty) file list when the manifest has no files", async () => {
    stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
      [MANIFEST_P1]: {
        data: { type: "dbt-manifests", id: "p1", attributes: { files: [] } },
      },
    });
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getDbtFiles!()).resolves.toEqual([]);
  });

  it("rejects on a non-2xx manifest response (fixtures kept upstream)", async () => {
    stubFetch({ [MANIFEST_P1]: MANIFEST_BODY }, false);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getDbtFiles!()).rejects.toThrow();
  });
});

describe("metadataApiSource — project sessions (getRecents/getAllChats)", () => {
  const SESSIONS_P1 = "/api/projects/p1/sessions";

  /** Six sessions out of last_active_at order, so sort + top-5 is observable. */
  const SESSION_ROUTES = {
    [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
    [SESSIONS_P1]: {
      data: [
        {
          id: "s1",
          title: "oldest",
          active_dataset_id: "d1",
          created_at: "2026-06-01T00:00:00Z",
          last_active_at: "2026-06-01T00:00:00Z",
        },
        {
          id: "s2",
          title: "newest",
          active_dataset_id: null,
          created_at: "2026-06-02T00:00:00Z",
          last_active_at: "2026-06-06T00:00:00Z",
        },
        {
          id: "s3",
          title: "third",
          active_dataset_id: "d3",
          created_at: "2026-06-03T00:00:00Z",
          last_active_at: "2026-06-04T00:00:00Z",
        },
        {
          id: "s4",
          title: "fourth",
          active_dataset_id: null,
          created_at: "2026-06-03T00:00:00Z",
          last_active_at: "2026-06-05T00:00:00Z",
        },
        {
          id: "s5",
          title: "fifth",
          active_dataset_id: null,
          created_at: "2026-06-03T00:00:00Z",
          last_active_at: "2026-06-03T00:00:00Z",
        },
        {
          id: "s6",
          title: "sixth",
          active_dataset_id: null,
          created_at: "2026-06-02T00:00:00Z",
          last_active_at: "2026-06-02T00:00:00Z",
        },
      ],
    },
  };

  const countPaths = (fetchMock: ReturnType<typeof vi.fn>) => {
    const counts: Record<string, number> = {};
    for (const call of fetchMock.mock.calls) {
      const path = (call[0] as string).split("?")[0];
      counts[path] = (counts[path] ?? 0) + 1;
    }
    return counts;
  };

  it("getAllChats fetches /api/projects/<pid>/sessions scoped to the injected pid and maps the full list", async () => {
    const fetchMock = stubFetch(SESSION_ROUTES);
    const source = metadataApiSource({ getToken: () => "tok" });
    const chats = await source.getAllChats!();

    const paths = fetchMock.mock.calls.map((c) => (c[0] as string).split("?")[0]);
    expect(paths).toContain(SESSIONS_P1);

    expect(chats).toHaveLength(6);
    expect(chats.map((c) => c.title).sort()).toEqual(
      ["fifth", "fourth", "newest", "oldest", "sixth", "third"].sort(),
    );
    // active_dataset_id ?? null mapping carries through.
    const oldest = chats.find((c) => c.title === "oldest")!;
    expect(oldest.nodeId).toBe("d1");
    const newest = chats.find((c) => c.title === "newest")!;
    expect(newest.nodeId).toBeNull();
  });

  it("getRecents returns the top-5-by-last_active_at subset in desc order", async () => {
    stubFetch(SESSION_ROUTES);
    const source = metadataApiSource({ getToken: () => "tok" });
    const recents = await source.getRecents!();

    expect(recents).toHaveLength(5);
    expect(recents.map((r) => r.title)).toEqual([
      "newest", // 06-06
      "fourth", // 06-05
      "third", // 06-04
      "fifth", // 06-03
      "sixth", // 06-02
    ]);
    // s1 (06-01, the oldest) is dropped past the top-5.
  });

  it("scopes the sessions URL to the injected project id (p2)", async () => {
    const fetchMock = stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }, { id: "p2", name: "Beta" }] },
      "/api/projects/p2/sessions": { data: [] },
    });
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p2",
    });
    await source.getAllChats!();
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain("/api/projects/p2/sessions");
    expect(urls).not.toContain("/api/projects/p1/sessions");
  });

  it("resolves [] on an empty project (no throw)", async () => {
    stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
      [SESSIONS_P1]: { data: [] },
    });
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getAllChats!()).resolves.toEqual([]);
    await expect(source.getRecents!()).resolves.toEqual([]);
  });

  it("rejects on a non-2xx sessions response", async () => {
    stubFetch(SESSION_ROUTES, false);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getAllChats!()).rejects.toThrow();
  });

  it("getRecents + getAllChats share ONE sessions fetch per pid (memoized)", async () => {
    const fetchMock = stubFetch(SESSION_ROUTES);
    const source = metadataApiSource({ getToken: () => "tok" });
    await Promise.all([source.getRecents!(), source.getAllChats!()]);
    expect(countPaths(fetchMock)["/api/projects/p1/sessions"]).toBe(1);
  });
});

describe("metadataApiSource — audit (getAudit / audit)", () => {
  const AUDIT_P1 = "/api/projects/p1/audit";

  /** A flat JSON:API list of assistant-audit rows across two nodes. */
  const AUDIT_BODY = {
    data: [
      {
        type: "audit-entries",
        id: "tc1",
        attributes: {
          node_id: "d1",
          node_kind: "dataset",
          tool: "trimWhitespace",
          say: "Trimmed whitespace on email",
          tag: "clean",
          transform_id: "t1",
          enabled: true,
        },
      },
      {
        type: "audit-entries",
        id: "tc2",
        attributes: {
          node_id: "d1",
          node_kind: "dataset",
          tool: "fillNulls",
          say: "Filled nulls in age",
          tag: "fix",
          transform_id: null,
          enabled: null,
        },
      },
      {
        type: "audit-entries",
        id: "tc3",
        attributes: {
          node_id: "v1",
          node_kind: "view",
          tool: "createView",
          say: "Created active_customers",
          tag: "create",
          transform_id: null,
          enabled: null,
        },
      },
    ],
  };

  it("fetches the project-scoped audit entries and groups them by node_id", async () => {
    const fetchMock = stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
      [AUDIT_P1]: AUDIT_BODY,
    });
    const source = metadataApiSource({ getToken: () => "tok" });

    const audit = await source.getAudit!();

    expect(fetchMock.mock.calls.map((c) => c[0] as string)).toContain(
      AUDIT_P1,
    );
    expect(Object.keys(audit).sort()).toEqual(["d1", "v1"]);
    expect(audit.d1).toHaveLength(2);
    expect(audit.v1).toHaveLength(1);
  });

  it("maps the payload fields and the joined transform fields onto AuditEntry", async () => {
    stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
      [AUDIT_P1]: AUDIT_BODY,
    });
    const source = metadataApiSource({ getToken: () => "tok" });

    const audit = await source.getAudit!();

    expect(audit.d1[0]).toEqual({
      tool: "trimWhitespace",
      say: "Trimmed whitespace on email",
      tag: "clean",
      auditEntryId: "tc1",
      transformId: "t1",
      enabled: true,
    });
    // Log-only entry: transformId null (passed through), enabled coerced to
    // undefined (the AuditEntry type is `enabled?: boolean`, no null).
    expect(audit.d1[1]).toEqual({
      tool: "fillNulls",
      say: "Filled nulls in age",
      tag: "fix",
      auditEntryId: "tc2",
      transformId: null,
      enabled: undefined,
    });
  });

  it("scopes the audit URL to the injected project id (p2)", async () => {
    const fetchMock = stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }, { id: "p2", name: "Beta" }] },
      "/api/projects/p2/audit": { data: [] },
    });
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p2",
    });
    await source.getAudit!();
    const urls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(urls).toContain("/api/projects/p2/audit");
    expect(urls).not.toContain("/api/projects/p1/audit");
  });

  it("resolves {} when the project has no audit entries (no throw)", async () => {
    stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
      [AUDIT_P1]: { data: [] },
    });
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getAudit!()).resolves.toEqual({});
  });

  it("rejects on a non-2xx audit response (fixtures kept upstream)", async () => {
    stubFetch({ [AUDIT_P1]: AUDIT_BODY }, false);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.getAudit!()).rejects.toThrow();
  });

  it("sends credentials:'include' and no Authorization on the audit request", async () => {
    const fetchMock = stubFetch({
      [PROJECTS]: { data: [{ id: "p1", name: "Acme" }] },
      [AUDIT_P1]: { data: [] },
    });
    const source = metadataApiSource({ getToken: () => "secret-token" });
    await source.getAudit!();
    const call = fetchMock.mock.calls.find((c) =>
      (c[0] as string).endsWith("/audit"),
    ) as unknown as [string, RequestInit];
    expect(call[1].credentials).toBe("include");
    expect(
      (call[1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });
});

describe("metadataApiSource — toggleAuditEntry (optimistic write-through PATCH)", () => {
  /** A fetch stub that succeeds for any URL and records the request init. */
  function stubPatch(ok = true) {
    const fetchMock = vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({
        data: { type: "audit-entries", id: "ae1", attributes: { node_id: "d1" } },
      }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("PATCHes the project-scoped audit-entry URL with the enabled body via the cookie session", async () => {
    const fetchMock = stubPatch();
    const source = metadataApiSource({
      getToken: () => "secret-token",
      getProjectId: () => "p1",
    });

    await source.toggleAuditEntry!("ae1", false);

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/projects/p1/audit/ae1");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body as string)).toEqual({ enabled: false });
    expect(call[1].credentials).toBe("include");
    expect(
      (call[1].headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });

  it("rejects on a non-2xx PATCH response (drives the catalog rollback)", async () => {
    stubPatch(false);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });
    await expect(source.toggleAuditEntry!("ae1", true)).rejects.toThrow();
  });
});

describe("metadataApiSource — renameModel (optimistic write-through PATCH)", () => {
  /** A fetch stub that succeeds for any URL and records the request init. */
  function stubPatch(ok = true) {
    const fetchMock = vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ data: {} }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("renames a dataset via its org-global URL, setting display_name", async () => {
    const fetchMock = stubPatch();
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    await source.renameModel!("d1", "dataset", "Customers");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/datasets/d1");
    expect(call[1].method).toBe("PATCH");
    expect(JSON.parse(call[1].body as string)).toEqual({
      display_name: "Customers",
    });
  });

  it("renames a view via the project-scoped URL, setting name", async () => {
    const fetchMock = stubPatch();
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    await source.renameModel!("v1", "view", "High Value Orders");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/projects/p1/views/v1");
    expect(JSON.parse(call[1].body as string)).toEqual({
      name: "High Value Orders",
    });
  });

  it("renames a report via the project-scoped URL, setting name", async () => {
    const fetchMock = stubPatch();
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    await source.renameModel!("r1", "report", "Revenue");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/projects/p1/reports/r1");
    expect(JSON.parse(call[1].body as string)).toEqual({ name: "Revenue" });
  });

  it("rejects on a non-2xx PATCH response (drives the catalog rollback)", async () => {
    stubPatch(false);
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });
    await expect(
      source.renameModel!("v1", "view", "x"),
    ).rejects.toThrow();
  });
});

describe("metadataApiSource — archiveModel / restoreModel (soft-delete POST)", () => {
  /** A fetch stub that succeeds for any URL and records the request init. */
  function stubPost(ok = true) {
    const fetchMock = vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ data: {} }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it("archives a dataset via POST /api/datasets/{id}/archive", async () => {
    const fetchMock = stubPost();
    const source = metadataApiSource({ getToken: () => "tok" });

    await source.archiveModel!("d1", "dataset");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/datasets/d1/archive");
    expect(call[1].method).toBe("POST");
  });

  it("restores a dataset via POST /api/datasets/{id}/restore", async () => {
    const fetchMock = stubPost();
    const source = metadataApiSource({ getToken: () => "tok" });

    await source.restoreModel!("d1", "dataset");

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/datasets/d1/restore");
    expect(call[1].method).toBe("POST");
  });

  it("no-ops (no request) for a non-dataset kind — views/reports have no soft-delete", async () => {
    const fetchMock = stubPost();
    const source = metadataApiSource({ getToken: () => "tok" });

    await source.archiveModel!("v1", "view");
    await source.restoreModel!("r1", "report");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects on a non-2xx archive response (drives the catalog rollback)", async () => {
    stubPost(false);
    const source = metadataApiSource({ getToken: () => "tok" });
    await expect(source.archiveModel!("d1", "dataset")).rejects.toThrow();
  });
});

describe("metadataApiSource — createDataset (multipart upload)", () => {
  it("POSTs a multipart upload (file + project_id) and returns the dataset id", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ data: { id: "ds.x" } }),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });

    const file = new Blob(["a,b\n1,2\n"], { type: "text/csv" }) as unknown as File;
    const res = await source.createDataset!(file);

    expect(res).toEqual({ id: "ds.x" });
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("/api/uploads");
    expect(call[1].method).toBe("POST");
    const fd = call[1].body as FormData;
    expect(fd.get("project_id")).toBe("p1");
    expect(fd.get("file")).toBeTruthy();
  });

  it("rejects on a non-2xx upload response", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const source = metadataApiSource({
      getToken: () => "tok",
      getProjectId: () => "p1",
    });
    const file = new Blob(["x"]) as unknown as File;
    await expect(source.createDataset!(file)).rejects.toThrow();
  });
});
