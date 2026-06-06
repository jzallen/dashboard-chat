import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDataCatalog } from "./client";
import type {
  CatalogSource,
  PartialCatalogSource,
} from "./dataSources/source";
import type { Edge, LineageNode } from "./lineage";
import type { ChatHistoryItem, ProjectSummary } from "./models";

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

  it("archiveSource removes the node + its edges from the graph and records cold storage", () => {
    const src = catalog.getNode("src.orders")!;
    catalog.archiveSource(src);

    expect(catalog.getNode("src.orders")).toBeUndefined();
    expect(
      catalog
        .listEdges()
        .some(([a, b]) => a === "src.orders" || b === "src.orders"),
    ).toBe(false);

    const cold = catalog.listColdStorage();
    expect(cold).toHaveLength(1);
    expect(cold[0].id).toBe("src.orders");
    expect(cold[0].name).toBe("orders");
    expect(cold[0].retentionDays).toBe(90);
  });

  it("restoreSource reverses archive (graph + cold storage)", () => {
    const src = catalog.getNode("src.orders")!;
    catalog.archiveSource(src);
    catalog.restoreSource("src.orders");

    expect(catalog.getNode("src.orders")).toBeDefined();
    expect(catalog.listEdges()).toContainEqual(["src.orders", "mart.revenue"]);
    expect(catalog.listColdStorage()).toHaveLength(0);
  });

  it("getNode is scoped to the visible graph — archived nodes resolve to undefined", () => {
    const src = catalog.getNode("src.orders")!;
    catalog.archiveSource(src);
    expect(catalog.getNode("src.orders")).toBeUndefined();
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
    // …then the primary's resolved value lands as a reactive update.
    const fired = vi.fn();
    catalog.subscribe(fired);
    await flush();
    expect(catalog.listProjects()).toEqual(BACKEND_PROJECTS);
    expect(fired).toHaveBeenCalled();
  });

  it("a primary that does not implement a getter keeps the fallback value", async () => {
    const catalog = await createDataCatalog({}, fallbackWithProjects());
    await flush();
    expect(catalog.listProjects()).toEqual(FIXTURE_PROJECTS);
  });

  it("a primary getter that rejects keeps the fallback value (no flash, no crash)", async () => {
    const primary: PartialCatalogSource = {
      getProjects: () => Promise.reject(new Error("backend down")),
    };
    const catalog = await createDataCatalog(primary, fallbackWithProjects());
    await flush();
    expect(catalog.listProjects()).toEqual(FIXTURE_PROJECTS);
  });
});

describe("createDataCatalog — stale-while-revalidate (lineage graph)", () => {
  /** A primary backing all three lineage getters with a dataset→view graph. */
  function lineagePrimary(): PartialCatalogSource {
    const nodes: Record<string, LineageNode> = {
      "ds.1": {
        id: "ds.1",
        label: "customers",
        sub: "staging",
        layer: "staging",
        ref: { kind: "dataset", fields: [] },
      },
      "view.1": {
        id: "view.1",
        label: "active",
        sub: "intermediate",
        layer: "intermediate",
        ref: { kind: "view", columns: [] },
      },
    };
    const edges: Edge[] = [["ds.1", "view.1"]];
    return {
      getNodes: () =>
        new Promise((resolve) => setTimeout(() => resolve(nodes), 0)),
      getEdges: () =>
        new Promise((resolve) => setTimeout(() => resolve(edges), 0)),
      getAudit: () => new Promise((resolve) => setTimeout(() => resolve({}), 0)),
    };
  }

  it("a primary backing all three lineage getters replaces the fixture graph after flush", async () => {
    const catalog = await createDataCatalog(lineagePrimary(), makeSource());

    // Mounts on the fallback graph (src.orders + mart.revenue)…
    expect(catalog.listNodes().map((n) => n.id).sort()).toEqual([
      "mart.revenue",
      "src.orders",
    ]);

    const fired = vi.fn();
    catalog.subscribe(fired);
    // The project-layout loader scopes the project, which loads its lineage.
    await catalog.selectProject("p1");
    await flush();

    // …then the backend graph lands and REPLACES the fixtures.
    expect(catalog.listNodes().map((n) => n.id).sort()).toEqual([
      "ds.1",
      "view.1",
    ]);
    expect(catalog.listModels().map((m) => m.id).sort()).toEqual([
      "ds.1",
      "view.1",
    ]);
    expect(catalog.listEdges()).toContainEqual(["ds.1", "view.1"]);
    expect(fired).toHaveBeenCalled();
  });

  it("a primary resolving an EMPTY lineage graph BLANKS the canvas (not fixtures)", async () => {
    const primary: PartialCatalogSource = {
      getNodes: () => new Promise((resolve) => setTimeout(() => resolve({}), 0)),
      getEdges: () => new Promise((resolve) => setTimeout(() => resolve([]), 0)),
      getAudit: () => new Promise((resolve) => setTimeout(() => resolve({}), 0)),
    };
    const catalog = await createDataCatalog(primary, makeSource());
    await catalog.selectProject("p1");
    await flush();
    expect(catalog.listNodes()).toEqual([]);
    expect(catalog.listEdges()).toEqual([]);
  });

  it("a getNodes-rejecting primary keeps the fixture graph (error path, no crash)", async () => {
    const primary: PartialCatalogSource = {
      getNodes: () => Promise.reject(new Error("backend down")),
      getEdges: () => Promise.resolve([]),
      getAudit: () => Promise.resolve({}),
    };
    const catalog = await createDataCatalog(primary, makeSource());
    await catalog.selectProject("p1");
    await flush();
    expect(catalog.listNodes().map((n) => n.id).sort()).toEqual([
      "mart.revenue",
      "src.orders",
    ]);
  });
});

describe("createDataCatalog — selectProject (per-project re-scope)", () => {
  /**
   * A primary whose lineage + currentProject reads are scoped by a mutable
   * `scopedPid` (the holder the source closes over). Each project resolves a
   * distinct one-node graph and a distinct currentProject. Org-global getters are
   * spied so we can assert they are NOT re-run on re-scope.
   */
  function scopedPrimary(getPid: () => string) {
    const graphs: Record<string, { nodes: Record<string, LineageNode>; edges: Edge[] }> = {
      p1: {
        nodes: {
          "p1.node": {
            id: "p1.node",
            label: "p1_view",
            sub: "intermediate",
            layer: "intermediate",
            ref: { kind: "view", columns: [] },
          },
        },
        edges: [],
      },
      p2: {
        nodes: {
          "p2.node": {
            id: "p2.node",
            label: "p2_view",
            sub: "intermediate",
            layer: "intermediate",
            ref: { kind: "view", columns: [] },
          },
        },
        edges: [],
      },
    };
    const projectsSpy = vi.fn(() =>
      Promise.resolve([] as unknown as ProjectSummary[]),
    );
    const orgSpy = vi.fn(() => Promise.resolve({} as never));
    const primary: PartialCatalogSource = {
      getProjects: projectsSpy,
      getOrg: orgSpy,
      getCurrentProject: () =>
        Promise.resolve({
          id: getPid(),
          name: getPid().toUpperCase(),
          description: "",
        }),
      getNodes: () =>
        new Promise((resolve) => setTimeout(() => resolve(graphs[getPid()].nodes), 0)),
      getEdges: () =>
        new Promise((resolve) => setTimeout(() => resolve(graphs[getPid()].edges), 0)),
      getAudit: () => new Promise((resolve) => setTimeout(() => resolve({}), 0)),
    };
    return { primary, projectsSpy, orgSpy };
  }

  it("re-derives the lineage graph + currentProject for the newly scoped project", async () => {
    let pid = "p1";
    const { primary } = scopedPrimary(() => pid);
    const catalog = await createDataCatalog(primary, makeSource());
    await catalog.selectProject("p1"); // the loader scopes the initial project
    await flush();

    expect(catalog.listNodes().map((n) => n.id)).toEqual(["p1.node"]);
    expect(catalog.getCurrentProject().id).toBe("p1");

    // Re-scope to p2: the source now reads p2, selectProject re-runs the scoped
    // getters and commits the new graph + currentProject.
    pid = "p2";
    await catalog.selectProject("p2");
    await flush();

    expect(catalog.listNodes().map((n) => n.id)).toEqual(["p2.node"]);
    expect(catalog.getCurrentProject().id).toBe("p2");
  });

  it("bumps the version and notifies subscribers on re-scope", async () => {
    let pid = "p1";
    const { primary } = scopedPrimary(() => pid);
    const catalog = await createDataCatalog(primary, makeSource());
    await flush();

    const fired = vi.fn();
    catalog.subscribe(fired);
    const before = catalog.getSnapshot();

    pid = "p2";
    await catalog.selectProject("p2");
    await flush();

    expect(fired).toHaveBeenCalled();
    expect(catalog.getSnapshot()).not.toBe(before);
  });

  it("resets per-project working mutations on switch (a rename does not leak)", async () => {
    let pid = "p1";
    const { primary } = scopedPrimary(() => pid);
    const catalog = await createDataCatalog(primary, makeSource());
    await catalog.selectProject("p1");
    await flush();

    catalog.renameSource("p1.node", "renamed_in_p1");
    expect(catalog.getNode("p1.node")?.label).toBe("renamed_in_p1");

    pid = "p2";
    await catalog.selectProject("p2");
    await flush();

    // p1's node (and its rename) is gone; p2's graph is fresh.
    expect(catalog.getNode("p1.node")).toBeUndefined();
    expect(catalog.getNode("p2.node")?.label).toBe("p2_view");
  });

  it("does NOT re-run org-global getters (getProjects/getOrg) on re-scope", async () => {
    let pid = "p1";
    const { primary, projectsSpy, orgSpy } = scopedPrimary(() => pid);
    const catalog = await createDataCatalog(primary, makeSource());
    await flush();

    // Construction ran each org-global getter once.
    expect(projectsSpy).toHaveBeenCalledTimes(1);
    expect(orgSpy).toHaveBeenCalledTimes(1);

    pid = "p2";
    await catalog.selectProject("p2");
    await flush();

    // Re-scope re-runs only the scoped getters — org-global counts unchanged.
    expect(projectsSpy).toHaveBeenCalledTimes(1);
    expect(orgSpy).toHaveBeenCalledTimes(1);
  });

  it("re-derives recents + chats for the newly scoped project (sessions are project-scoped)", async () => {
    let pid = "p1";
    const recentsByPid: Record<string, ChatHistoryItem[]> = {
      p1: [{ title: "p1 chat", nodeId: "p1.node", when: "1m ago" }],
      p2: [{ title: "p2 chat", nodeId: null, when: "2m ago" }],
    };
    const chatsByPid: Record<string, ChatHistoryItem[]> = {
      p1: [
        { title: "p1 chat", nodeId: "p1.node", when: "1m ago" },
        { title: "p1 older", nodeId: null, when: "1h ago" },
      ],
      p2: [{ title: "p2 chat", nodeId: null, when: "2m ago" }],
    };
    const { primary } = scopedPrimary(() => pid);
    primary.getRecents = () =>
      new Promise((resolve) => setTimeout(() => resolve(recentsByPid[pid]), 0));
    primary.getAllChats = () =>
      new Promise((resolve) => setTimeout(() => resolve(chatsByPid[pid]), 0));

    const catalog = await createDataCatalog(primary, makeSource());
    await catalog.selectProject("p1"); // the loader scopes the initial project
    await flush();

    expect(catalog.listRecents().map((r) => r.title)).toEqual(["p1 chat"]);
    expect(catalog.listChats().map((c) => c.title)).toEqual([
      "p1 chat",
      "p1 older",
    ]);

    pid = "p2";
    await catalog.selectProject("p2");
    await flush();

    expect(catalog.listRecents().map((r) => r.title)).toEqual(["p2 chat"]);
    expect(catalog.listChats().map((c) => c.title)).toEqual(["p2 chat"]);
  });

  it("re-scope to a project with no sessions yields empty recents + chats (not fixtures)", async () => {
    let pid = "p1";
    const { primary } = scopedPrimary(() => pid);
    primary.getRecents = () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve(
              pid === "p1"
                ? [{ title: "p1 chat", nodeId: null, when: "1m ago" }]
                : [],
            ),
          0,
        ),
      );
    primary.getAllChats = () =>
      new Promise((resolve) =>
        setTimeout(
          () =>
            resolve(
              pid === "p1"
                ? [{ title: "p1 chat", nodeId: null, when: "1m ago" }]
                : [],
            ),
          0,
        ),
      );

    const catalog = await createDataCatalog(primary, makeSource());
    await catalog.selectProject("p1"); // the loader scopes the initial project
    await flush();
    expect(catalog.listRecents()).toHaveLength(1);

    pid = "p2";
    await catalog.selectProject("p2");
    await flush();

    expect(catalog.listRecents()).toEqual([]);
    expect(catalog.listChats()).toEqual([]);
  });

  it("drops a stale commit from a fast A→B→A switch (captured-pid guard)", async () => {
    // A primary whose getNodes resolves on a per-pid delay: p2 is SLOW, p1 fast.
    // A→B→A must land A's graph, never B's late one.
    const graphs: Record<string, Record<string, LineageNode>> = {
      p1: {
        "p1.node": {
          id: "p1.node",
          label: "p1_view",
          sub: "intermediate",
          layer: "intermediate",
          ref: { kind: "view", columns: [] },
        },
      },
      p2: {
        "p2.node": {
          id: "p2.node",
          label: "p2_view",
          sub: "intermediate",
          layer: "intermediate",
          ref: { kind: "view", columns: [] },
        },
      },
    };
    let pid = "p1";
    const delays: Record<string, number> = { p1: 0, p2: 50 };
    const primary: PartialCatalogSource = {
      getCurrentProject: () =>
        Promise.resolve({ id: pid, name: pid, description: "" }),
      getNodes: () => {
        const captured = pid;
        return new Promise((resolve) =>
          setTimeout(() => resolve(graphs[captured]), delays[captured]),
        );
      },
      getEdges: () => Promise.resolve([]),
      getAudit: () => Promise.resolve({}),
    };
    const catalog = await createDataCatalog(primary, makeSource());
    await flush();

    // Fast A→B→A: kick B (slow), then immediately back to A (fast).
    pid = "p2";
    const bSwitch = catalog.selectProject("p2");
    pid = "p1";
    const aSwitch = catalog.selectProject("p1");
    await Promise.all([bSwitch, aSwitch]);
    await new Promise((r) => setTimeout(r, 80)); // outlast p2's 50ms delay

    // The late p2 commit must have been dropped — A's graph stands.
    expect(catalog.listNodes().map((n) => n.id)).toEqual(["p1.node"]);
  });

  it("construction does NOT eagerly load a project — only selectProject does (no seed-scope race)", async () => {
    // The route is the single source of the current project: construction loads
    // ONLY org-global getters, so there's no seed-scope (first-project) default that
    // could race a cold deep-link to another project. The project's sessions/lineage
    // load exclusively when the layout loader calls selectProject.
    const getAllChats = vi.fn(() =>
      Promise.resolve([{ title: "p2 chat", nodeId: null }] as ChatHistoryItem[]),
    );
    const getNodes = vi.fn(() => Promise.resolve({} as Record<string, LineageNode>));
    const getCurrentProject = vi.fn(() =>
      Promise.resolve({ id: "p2", name: "P2", description: "" }),
    );
    const primary: PartialCatalogSource = {
      getProjects: () => Promise.resolve([] as unknown as ProjectSummary[]),
      getCurrentProject,
      getAllChats,
      getNodes,
      getEdges: () => Promise.resolve([]),
      getAudit: () => Promise.resolve({}),
    };

    const catalog = await createDataCatalog(primary, makeSource());
    await flush();

    // Construction touched no project-scoped getter — no eager seed-scope load.
    expect(getCurrentProject).not.toHaveBeenCalled();
    expect(getAllChats).not.toHaveBeenCalled();
    expect(getNodes).not.toHaveBeenCalled();

    // The route loader scopes the project; now (and only now) they load.
    await catalog.selectProject("p2");
    await flush();
    expect(getAllChats).toHaveBeenCalledTimes(1);
    expect(catalog.listChats().map((c) => c.title)).toEqual(["p2 chat"]);
    expect(catalog.getCurrentProject().id).toBe("p2");
  });
});
