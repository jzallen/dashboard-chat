import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDataCatalog } from "./client";
import type {
  CatalogSource,
  PartialCatalogSource,
} from "./dataSources/source";
import type { Edge, LineageNode } from "./lineage";
import type { ProjectSummary } from "./models";

/**
 * A tiny in-memory complete CatalogSource (the FALLBACK): one source node, one
 * mart-with-ref, one edge between them, and empty everything else. Getters are
 * async (`Promise.resolve`) per the CatalogSource port. Enough to exercise the
 * catalog's write side and delegated reads without dragging in fixtureData.js.
 */
function makeSource(): CatalogSource {
  const nodes: Record<string, LineageNode> = {
    "src.orders": {
      id: "src.orders",
      label: "orders",
      sub: "source",
      layer: "source",
      schema: [{ name: "id", type: "integer" }],
      files: [{ name: "orders.csv", rows: 10, when: "today" }],
    },
    "mart.revenue": {
      id: "mart.revenue",
      label: "revenue",
      sub: "mart",
      layer: "mart",
      ref: { columns_metadata: [] },
    },
  };
  const edges: Edge[] = [["src.orders", "mart.revenue"]];
  // Boundary payloads the catalog never inspects in these tests — empty/cast.
  const empty = [] as unknown;
  return {
    getProjects: () => Promise.resolve(empty as never),
    getCurrentProject: () => Promise.resolve({} as never),
    getOrg: () => Promise.resolve({} as never),
    getRecents: () => Promise.resolve(empty as never),
    getAllChats: () => Promise.resolve(empty as never),
    getNodes: () => Promise.resolve(nodes),
    getEdges: () => Promise.resolve(edges),
    getAudit: () => Promise.resolve({}),
    getChatScript: () => Promise.resolve({} as never),
    getDbtFiles: () => Promise.resolve(empty as never),
  };
}

/** A pause for queued microtasks so background revalidation `.then`s settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const FIXTURE_PROJECTS: ProjectSummary[] = [
  { id: "fixture", name: "Demo Project", desc: "", datasets: 0, models: 0 },
];

/** A complete fallback whose projects are a known fixture value. */
function fallbackWithProjects(): CatalogSource {
  const base = makeSource();
  return { ...base, getProjects: () => Promise.resolve(FIXTURE_PROJECTS) };
}

describe("createDataCatalog — write side", () => {
  let catalog: Awaited<ReturnType<typeof createDataCatalog>>;

  beforeEach(async () => {
    // No primary: the catalog is seeded purely from the fallback.
    catalog = await createDataCatalog({}, makeSource());
  });

  it("renameSource propagates to the catalog's node reads", () => {
    catalog.renameSource("src.orders", "raw_orders");
    expect(catalog.getNode("src.orders")?.label).toBe("raw_orders");
  });

  it("parentsOf reflects renames (over the working state, not raw source)", () => {
    catalog.renameSource("src.orders", "raw_orders");
    const parents = catalog.parentsOf("mart.revenue");
    expect(parents.map((p) => p.label)).toContain("raw_orders");
  });

  it("addModel adds the node + edge and lists it as a model", () => {
    const node: LineageNode = {
      id: "mart.churn",
      label: "churn",
      sub: "mart",
      layer: "mart",
      ref: { columns_metadata: [] },
    };
    const edge: Edge = ["mart.revenue", "mart.churn"];
    catalog.addModel(node, edge);

    expect(catalog.getNode("mart.churn")).toBeDefined();
    expect(catalog.listEdges()).toContainEqual(edge);
    expect(catalog.listModels().map((m) => m.id)).toContain("mart.churn");
  });

  it("addModel dedups repeated node + edge", () => {
    const node: LineageNode = {
      id: "mart.churn",
      label: "churn",
      sub: "mart",
      layer: "mart",
      ref: { columns_metadata: [] },
    };
    const edge: Edge = ["mart.revenue", "mart.churn"];
    catalog.addModel(node, edge);
    catalog.addModel(node, edge);

    expect(catalog.listAddedNodes()).toHaveLength(1);
    expect(
      catalog.listEdges().filter(([a, b]) => a === edge[0] && b === edge[1]),
    ).toHaveLength(1);
  });

  it("getSnapshot returns a stable version that bumps only on mutation", () => {
    const before = catalog.getSnapshot();
    expect(catalog.getSnapshot()).toBe(before);

    catalog.renameSource("src.orders", "raw_orders");
    const after = catalog.getSnapshot();
    expect(after).not.toBe(before);
    expect(catalog.getSnapshot()).toBe(after);
  });

  it("subscribe fires on each mutation; getSnapshot bumps; unsubscribe stops calls", () => {
    const fn = vi.fn();
    const v0 = catalog.getSnapshot();
    const unsubscribe = catalog.subscribe(fn);

    catalog.renameSource("src.orders", "a");
    expect(fn).toHaveBeenCalledTimes(1);
    const v1 = catalog.getSnapshot();
    expect(v1).not.toBe(v0);

    catalog.renameSource("src.orders", "b");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(catalog.getSnapshot()).not.toBe(v1);

    unsubscribe();
    catalog.renameSource("src.orders", "c");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

// The archive/restore optimistic write-through describe blocks are removed:
// catalog.archiveSource and catalog.restoreSource are deleted. Archive/restore
// now lands via useFetcher → /ui-server/datasets/:id/archive|restore.
// Coverage: archive.wiring.test.tsx and restore.wiring.test.tsx.

describe("createDataCatalog — createSourceFromUpload (saga + optimistic node)", () => {
  const file = new File(["a,b\n1,2\n"], "orders.csv", { type: "text/csv" });

  /** A backend primary whose source-saga ports resolve the linked dataset, and
   *  whose lineage reads reflect the real source + staging node after process. */
  function sagaPrimary() {
    let linked = false;
    return {
      getCurrentProject: () =>
        Promise.resolve({ id: "p1", name: "P1", description: "" }),
      getNodes: (): Promise<Record<string, LineageNode>> =>
        Promise.resolve(
          linked
            ? {
                "src.real": { id: "src.real", label: "orders_csv", sub: "source", layer: "source", schema: [], files: [] },
                "ds.real": { id: "ds.real", label: "orders", sub: "staging", layer: "staging", ref: { fields: [] } },
              }
            : ({} as Record<string, LineageNode>),
        ),
      getEdges: () => Promise.resolve(linked ? ([["src.real", "ds.real"]] as Edge[]) : []),
      getAudit: () => Promise.resolve({}),
      createSource: vi.fn(async () => ({ id: "src.real" })),
      requestUpload: vi.fn(async () => ({
        uploadId: "up.1",
        putUrl: "https://minio.local/k?sig=x",
        storageKey: "k",
      })),
      putToStorage: vi.fn(async () => undefined),
      processUpload: vi.fn(async () => {
        linked = true;
        return { datasetId: "ds.real" };
      }),
      invalidateScope: vi.fn(),
    } satisfies PartialCatalogSource;
  }

  it("adds an optimistic node, drives the saga, posts ordered events, and revalidates", async () => {
    const primary = sagaPrimary();
    const catalog = await createDataCatalog(primary, makeSource());
    await catalog.selectProject("p1");
    await flush();

    const reported: string[] = [];
    const report = vi.fn(async (e: { type: string }) => {
      reported.push(e.type);
      return {} as never;
    });
    const revalidate = vi.fn();

    const result = await catalog.createSourceFromUpload(
      file,
      "orders_csv",
      report,
      revalidate,
    );

    expect(primary.createSource).toHaveBeenCalledWith("orders_csv");
    expect(primary.requestUpload).toHaveBeenCalledWith("src.real", file);
    expect(primary.putToStorage).toHaveBeenCalledWith(
      "https://minio.local/k?sig=x",
      file,
    );
    expect(primary.processUpload).toHaveBeenCalledWith(
      "src.real",
      "up.1",
      undefined,
    );
    expect(reported).toEqual([
      "source_create_requested",
      "source_created",
      "source_upload_started",
      "source_upload_processed",
    ]);
    expect(result?.datasetId).toBe("ds.real");
    // The saga triggers a framework revalidation so the loader re-derives the
    // real source + staging node from server truth.
    expect(revalidate).toHaveBeenCalled();
  });

  it("rolls back the optimistic node + reports failure when the saga rejects", async () => {
    const primary = sagaPrimary();
    primary.processUpload = vi.fn(async () => {
      throw new Error("409 schema mismatch");
    });
    const catalog = await createDataCatalog(primary, makeSource());
    await catalog.selectProject("p1");
    await flush();

    const reported: string[] = [];
    const report = vi.fn(async (e: { type: string }) => {
      reported.push(e.type);
      return {} as never;
    });

    await expect(
      catalog.createSourceFromUpload(file, "orders_csv", report, vi.fn()),
    ).rejects.toThrow();

    expect(reported).toContain("source_upload_failed");
    expect(reported).not.toContain("source_upload_processed");
    // No optimistic node leaks (the only nodes are the fallback's, no temp left).
    expect(
      catalog.listNodes().filter((n) => n.layer === "source" && n.label === "orders_csv"),
    ).toEqual([]);
  });

  it("is a no-op (undefined) when the source backs no source-upload ports", async () => {
    const catalog = await createDataCatalog({}, makeSource());
    const report = vi.fn(async () => ({}) as never);
    await expect(
      catalog.createSourceFromUpload(file, "x", report, vi.fn()),
    ).resolves.toBeUndefined();
  });
});

describe("createDataCatalog — stale-while-revalidate (primary over fallback)", () => {
  const BACKEND_PROJECTS: ProjectSummary[] = [
    { id: "acme", name: "Acme Warehouse", desc: "real", datasets: 2, models: 0 },
  ];

  it("seeds from the fallback immediately, then a present primary getter overrides it", async () => {
    // A real backend getter settles on a macrotask (like fetch), so the seeded
    // fallback state is observable before revalidation lands.
    const primary: PartialCatalogSource = {
      getProjects: () =>
        new Promise((resolve) => setTimeout(() => resolve(BACKEND_PROJECTS), 0)),
    };
    const catalog = await createDataCatalog(primary, fallbackWithProjects());

    // Mounts instantly on the fallback…
    expect(catalog.listProjects()).toEqual(FIXTURE_PROJECTS);
    // …then the primary's resolved value lands when the app shell refreshes.
    const fired = vi.fn();
    catalog.subscribe(fired);
    await catalog.refreshOrgGlobal();
    expect(catalog.listProjects()).toEqual(BACKEND_PROJECTS);
    expect(fired).toHaveBeenCalled();
  });

  it("does NOT fetch org-global at construction (no pre-auth fetch); refreshOrgGlobal triggers it", async () => {
    // Regression: construction running getProjects before a token exists 401s and
    // strands the fixture projects (driving a redirect to a nonexistent project).
    // Construction must stay quiet; the authenticated app shell triggers the load.
    const projectsSpy = vi.fn(() => Promise.resolve(BACKEND_PROJECTS));
    const catalog = await createDataCatalog(
      { getProjects: projectsSpy },
      fallbackWithProjects(),
    );
    await flush();
    expect(projectsSpy).not.toHaveBeenCalled();
    expect(catalog.listProjects()).toEqual(FIXTURE_PROJECTS);

    await catalog.refreshOrgGlobal();
    expect(projectsSpy).toHaveBeenCalledTimes(1);
    expect(catalog.listProjects()).toEqual(BACKEND_PROJECTS);
  });

  it("refreshOrgGlobal drops the primary's org-global memo FIRST, so a later refresh observes the updated projects list", async () => {
    // Simulate metadataApiSource's memo: getProjects latches its first result
    // until invalidateOrgGlobal drops it. If refreshOrgGlobal does not call
    // invalidateOrgGlobal before re-reading, the second refresh re-serves the
    // latched pre-onboarding [] and the new project never lands.
    let backend: ProjectSummary[] = [];
    let memo: ProjectSummary[] | undefined;
    const primary: PartialCatalogSource = {
      getProjects: () => Promise.resolve((memo ??= backend)),
      invalidateOrgGlobal: () => {
        memo = undefined;
      },
    };
    const catalog = await createDataCatalog(primary, fallbackWithProjects());

    await catalog.refreshOrgGlobal(); // latches the empty pre-onboarding list
    expect(catalog.listProjects()).toEqual([]);

    backend = BACKEND_PROJECTS; // onboarding created the first project
    await catalog.refreshOrgGlobal();
    expect(catalog.listProjects()).toEqual(BACKEND_PROJECTS);
  });

  it("refreshOrgGlobal tolerates a primary WITHOUT invalidateOrgGlobal (no crash, projects still land)", async () => {
    const primary: PartialCatalogSource = {
      getProjects: () => Promise.resolve(BACKEND_PROJECTS),
    };
    const catalog = await createDataCatalog(primary, fallbackWithProjects());
    await expect(catalog.refreshOrgGlobal()).resolves.toBeUndefined();
    expect(catalog.listProjects()).toEqual(BACKEND_PROJECTS);
  });

  it("a primary that does not implement a getter keeps the fallback value", async () => {
    const catalog = await createDataCatalog({}, fallbackWithProjects());
    await catalog.refreshOrgGlobal();
    expect(catalog.listProjects()).toEqual(FIXTURE_PROJECTS);
  });

  it("a primary getter that rejects keeps the fallback value (no flash, no crash)", async () => {
    const primary: PartialCatalogSource = {
      getProjects: () => Promise.reject(new Error("backend down")),
    };
    const catalog = await createDataCatalog(primary, fallbackWithProjects());
    await catalog.refreshOrgGlobal();
    expect(catalog.listProjects()).toEqual(FIXTURE_PROJECTS);
  });
});

describe("createDataCatalog — seedProjectScoped (per-project re-scope)", () => {
  // The project-layout loader fetches the scoped reads server-side; the component
  // commits them through seedProjectScoped. Re-scope is therefore driven here via
  // that seam — the client store no longer fetches project-scoped data itself.

  const p1Node: LineageNode = {
    id: "p1.node",
    label: "p1_view",
    sub: "intermediate",
    layer: "intermediate",
    ref: { kind: "view", columns: [] },
  };
  const p2Node: LineageNode = {
    id: "p2.node",
    label: "p2_view",
    sub: "intermediate",
    layer: "intermediate",
    ref: { kind: "view", columns: [] },
  };

  type Seed = Parameters<
    Awaited<ReturnType<typeof createDataCatalog>>["seedProjectScoped"]
  >[0];

  /** A minimal scoped-seed payload for a single-node project. */
  function seed(
    projectId: string,
    node: LineageNode,
    extra: Partial<Seed> = {},
  ): Seed {
    return {
      projectId,
      nodes: { [node.id]: node },
      edges: [],
      audit: {},
      dbtFiles: [],
      chats: [],
      recents: [],
      ...extra,
    };
  }

  it("re-derives the lineage graph + currentProject for the newly scoped project", async () => {
    const catalog = await createDataCatalog({}, makeSource());

    catalog.seedProjectScoped(seed("p1", p1Node));
    expect(catalog.listNodes().map((n) => n.id)).toEqual(["p1.node"]);
    expect(catalog.getCurrentProject().id).toBe("p1");

    catalog.seedProjectScoped(seed("p2", p2Node));
    expect(catalog.listNodes().map((n) => n.id)).toEqual(["p2.node"]);
    expect(catalog.getCurrentProject().id).toBe("p2");
  });

  it("bumps the version and notifies subscribers on re-scope", async () => {
    const catalog = await createDataCatalog({}, makeSource());
    const fired = vi.fn();
    catalog.subscribe(fired);
    const before = catalog.getSnapshot();

    catalog.seedProjectScoped(seed("p2", p2Node));

    expect(fired).toHaveBeenCalled();
    expect(catalog.getSnapshot()).not.toBe(before);
  });

  it("resets per-project working mutations on switch (a rename does not leak)", async () => {
    const catalog = await createDataCatalog({}, makeSource());
    catalog.seedProjectScoped(seed("p1", p1Node));

    catalog.renameSource("p1.node", "renamed_in_p1");
    expect(catalog.getNode("p1.node")?.label).toBe("renamed_in_p1");

    catalog.seedProjectScoped(seed("p2", p2Node));

    // p1's node (and its rename) is gone; p2's graph is fresh.
    expect(catalog.getNode("p1.node")).toBeUndefined();
    expect(catalog.getNode("p2.node")?.label).toBe("p2_view");
  });

  it("leaves the org-global projects list untouched on re-scope", async () => {
    const catalog = await createDataCatalog({}, fallbackWithProjects());
    const before = catalog.listProjects();

    catalog.seedProjectScoped(seed("p2", p2Node));

    expect(catalog.listProjects()).toEqual(before);
  });

  it("re-derives recents + chats for the newly scoped project (sessions are project-scoped)", async () => {
    const catalog = await createDataCatalog({}, makeSource());
    catalog.seedProjectScoped(
      seed("p1", p1Node, {
        recents: [{ title: "p1 chat", nodeId: "p1.node", when: "1m ago" }],
        chats: [
          { title: "p1 chat", nodeId: "p1.node", when: "1m ago" },
          { title: "p1 older", nodeId: null, when: "1h ago" },
        ],
      }),
    );

    expect(catalog.listRecents().map((r) => r.title)).toEqual(["p1 chat"]);
    expect(catalog.listChats().map((c) => c.title)).toEqual([
      "p1 chat",
      "p1 older",
    ]);

    catalog.seedProjectScoped(
      seed("p2", p2Node, {
        recents: [{ title: "p2 chat", nodeId: null, when: "2m ago" }],
        chats: [{ title: "p2 chat", nodeId: null, when: "2m ago" }],
      }),
    );

    expect(catalog.listRecents().map((r) => r.title)).toEqual(["p2 chat"]);
    expect(catalog.listChats().map((c) => c.title)).toEqual(["p2 chat"]);
  });

  it("re-derives dbtFiles for the newly scoped project (the manifest is project-scoped)", async () => {
    const catalog = await createDataCatalog({}, makeSource());
    catalog.seedProjectScoped(
      seed("p1", p1Node, {
        dbtFiles: [
          { path: "models/staging/stg_p1.sql", layer: "staging", ref: "stg_p1" },
        ],
      }),
    );

    expect(catalog.listDbtFiles().map((f) => f.path)).toEqual([
      "models/staging/stg_p1.sql",
    ]);

    catalog.seedProjectScoped(
      seed("p2", p2Node, {
        dbtFiles: [
          { path: "models/staging/stg_p2.sql", layer: "staging", ref: "stg_p2" },
        ],
      }),
    );

    expect(catalog.listDbtFiles().map((f) => f.path)).toEqual([
      "models/staging/stg_p2.sql",
    ]);
  });

  it("a re-scope to a project with no sessions yields empty recents + chats (not fixtures)", async () => {
    const catalog = await createDataCatalog({}, makeSource());
    catalog.seedProjectScoped(
      seed("p1", p1Node, {
        recents: [{ title: "p1 chat", nodeId: null, when: "1m ago" }],
        chats: [{ title: "p1 chat", nodeId: null, when: "1m ago" }],
      }),
    );
    expect(catalog.listRecents()).toHaveLength(1);

    catalog.seedProjectScoped(seed("p2", p2Node));

    expect(catalog.listRecents()).toEqual([]);
    expect(catalog.listChats()).toEqual([]);
  });

  it("construction does NOT eagerly load a project (the route seeds the scope)", async () => {
    const getNodes = vi.fn(() => Promise.resolve({} as Record<string, LineageNode>));
    const getCurrentProject = vi.fn(() =>
      Promise.resolve({ id: "p2", name: "P2", description: "" }),
    );
    const primary: PartialCatalogSource = {
      getProjects: () => Promise.resolve([] as unknown as ProjectSummary[]),
      getCurrentProject,
      getNodes,
      getEdges: () => Promise.resolve([]),
      getAudit: () => Promise.resolve({}),
    };

    const catalog = await createDataCatalog(primary, makeSource());
    await flush();

    // Construction touched no project-scoped getter — the route seeds the scope.
    expect(getCurrentProject).not.toHaveBeenCalled();
    expect(getNodes).not.toHaveBeenCalled();

    catalog.seedProjectScoped(seed("p2", p2Node));
    expect(catalog.getCurrentProject().id).toBe("p2");
    expect(catalog.listNodes().map((n) => n.id)).toEqual(["p2.node"]);
  });
});
