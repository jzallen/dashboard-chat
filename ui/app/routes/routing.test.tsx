// @vitest-environment happy-dom
import { act, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAll, setToken } from "../auth/tokenStorage";
import type {
  CatalogSource,
  Edge,
  LineageNode,
  PartialCatalogSource,
  ProjectSummary,
} from "../catalog";
import {
  currentScopedProjectIdForTest,
  installCatalogForTest,
} from "../components/useCatalog";
import {
  fixtureFallback,
  fixtureNodes,
  NO_PRIMARY,
} from "./_fixtureCatalog";
import { TestProviders, testRouteTree } from "./_testRoutes";

/** Render the route tree at a URL under the same providers root.tsx supplies. */
function renderAt(initialEntries: string[]) {
  const router = createMemoryRouter(testRouteTree, { initialEntries });
  const utils = render(
    <TestProviders>
      <RouterProvider router={router} />
    </TestProviders>,
  );
  return { router, ...utils };
}

beforeEach(async () => {
  clearAll();
  setToken("test-token");
  await installCatalogForTest(NO_PRIMARY, fixtureFallback());
});

afterEach(() => {
  clearAll();
  vi.useRealTimers();
});

describe("route mapping (URL → view)", () => {
  it("renders the view ModelDetail for /project/proj-1/view/v1", async () => {
    renderAt(["/project/proj-1/view/v1"]);
    // The friendly model name (m.name) is unique to <ModelDetail>'s header
    // (the node label also appears in the Topbar breadcrumb).
    expect(await screen.findByText("Active Customers")).toBeTruthy();
  });

  it("renders the dataset ModelDetail for /project/proj-1/dataset/d1", async () => {
    renderAt(["/project/proj-1/dataset/d1"]);
    expect(await screen.findByText("Customers (staging)")).toBeTruthy();
  });

  it("renders the report ModelDetail for /project/proj-1/report/r1", async () => {
    renderAt(["/project/proj-1/report/r1"]);
    expect(await screen.findByText("Revenue Fact")).toBeTruthy();
  });

  it("renders the workspace at /project/proj-1", async () => {
    renderAt(["/project/proj-1"]);
    expect(await screen.findByText("Pipeline")).toBeTruthy();
  });

  it("renders org settings at /org", async () => {
    renderAt(["/org"]);
    // "Pipeline defaults" is a panel heading unique to <OrgSettings>.
    expect(await screen.findByText("Pipeline defaults")).toBeTruthy();
  });

  it("renders the sign-in button at /login", async () => {
    clearAll(); // unauthenticated
    renderAt(["/login"]);
    expect(await screen.findByText("Sign in (dev)")).toBeTruthy();
  });
});

describe("home redirect (/)", () => {
  it("redirects / to /project/<first project>", async () => {
    const { router } = renderAt(["/"]);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/project/proj-1");
    });
    expect(await screen.findByText("Pipeline")).toBeTruthy();
  });

  it("renders the onboarding panel (no crash) when the org has no projects", async () => {
    // Empty-org fallback: getProjects → []. The home redirect must NOT bounce to
    // /login or navigate to /project/undefined — it shows an inline panel.
    const emptyOrg: CatalogSource = {
      ...fixtureFallback(),
      getProjects: () => Promise.resolve([] as ProjectSummary[]),
    };
    await installCatalogForTest(NO_PRIMARY, emptyOrg);
    const { router } = renderAt(["/"]);
    expect(await screen.findByTestId("no-projects")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("project re-scope (the layout loader)", () => {
  it("re-scopes the catalog to the path project via selectProject", async () => {
    // A primary that records selectProject's effect: the layout loader sets the
    // scoped pid before re-running getters. We assert the holder reflects the URL.
    const fixtureG = fixtureNodes();
    const primary: PartialCatalogSource = {
      getNodes: () => Promise.resolve(fixtureG),
      getEdges: () => Promise.resolve([] as Edge[]),
      getAudit: () => Promise.resolve({}),
    };
    await installCatalogForTest(primary, fixtureFallback());

    renderAt(["/project/proj-2/view/v1"]);
    await screen.findByText("Active Customers");
    // The loader scoped the catalog to the path project, not the first.
    expect(currentScopedProjectIdForTest()).toBe("proj-2");
  });
});

describe("cross-project deep-link (the core regression)", () => {
  /**
   * A project-scoped primary: project p1 has only d1/v1/r1 (the fixtures); p2 has
   * a DISTINCT node `p2.only` that exists ONLY in p2's lineage. The deep-link
   * `/project/proj-2/view/p2.only` must resolve after the layout loader re-scopes
   * to p2 and p2's lineage commits — a node hardwired to the first project would
   * never resolve.
   */
  function perProjectPrimary(getScoped: () => string | undefined): PartialCatalogSource {
    const p2Only: LineageNode = {
      id: "p2.only",
      label: "p2_only_view",
      sub: "intermediate view",
      layer: "intermediate",
      ref: {
        kind: "view",
        name: "P2 Only View",
        model: "p2_only_view",
        materialization: "view",
        rows: 0,
        source_refs: [],
        columns: [],
        joins: [],
        filters: [],
        grain: { time_column: "", dimensions: [] },
        preview: [],
        sql: "select 1",
      },
    };
    const graphs: Record<string, Record<string, LineageNode>> = {
      "proj-1": fixtureNodes(),
      "proj-2": { "p2.only": p2Only },
    };
    const nodesFor = () => graphs[getScoped() ?? "proj-1"] ?? {};
    // Small observable delay so the skeleton is catchable before the re-scope
    // commit lands (see deep-link race test).
    return {
      getCurrentProject: () => {
        const id = getScoped() ?? "proj-1";
        return Promise.resolve({ id, name: id, description: "" });
      },
      getNodes: () =>
        new Promise((resolve) => setTimeout(() => resolve(nodesFor()), 40)),
      getEdges: () => new Promise((resolve) => setTimeout(() => resolve([]), 40)),
      getAudit: () => new Promise((resolve) => setTimeout(() => resolve({}), 40)),
    };
  }

  it("resolves a node that exists ONLY in the path project (skeleton → ModelDetail)", async () => {
    const primary = perProjectPrimary(currentScopedProjectIdForTest);
    await installCatalogForTest(primary, fixtureFallback());

    renderAt(["/project/proj-2/view/p2.only"]);

    // Once the loader's microtask resolves, the skeleton renders (p2's node not
    // yet committed), no crash.
    expect(await screen.findByTestId("model-detail-skeleton")).toBeTruthy();

    // After the loader re-scopes to p2 and p2's lineage commits, the node that
    // exists only in p2 resolves to its ModelDetail.
    await waitFor(() => {
      expect(screen.getByText("P2 Only View")).toBeTruthy();
    });
  });
});

describe("deep-link race (async node resolution)", () => {
  /** A primary whose lineage getters resolve a deep-linked node a tick late. */
  function lateNodePrimary(): PartialCatalogSource {
    const nodes: Record<string, LineageNode> = {
      ...fixtureNodes(),
      "late.view": {
        id: "late.view",
        label: "late_resolved_view",
        sub: "intermediate view",
        layer: "intermediate",
        ref: {
          kind: "view",
          name: "Late View",
          model: "late_resolved_view",
          materialization: "view",
          rows: 0,
          source_refs: [],
          columns: [],
          joins: [],
          filters: [],
          grain: { time_column: "", dimensions: [] },
          preview: [],
          sql: "select 1",
        },
      },
    };
    // A small observable delay (> the loader's microtask, < the poll interval)
    // so the bounded-pending skeleton is deterministically catchable before the
    // lineage commit lands.
    return {
      getNodes: () =>
        new Promise((resolve) => setTimeout(() => resolve(nodes), 40)),
      getEdges: () => new Promise((resolve) => setTimeout(() => resolve([]), 40)),
      getAudit: () => new Promise((resolve) => setTimeout(() => resolve({}), 40)),
    };
  }

  it("shows the skeleton first, then ModelDetail after the catalog revalidates", async () => {
    // The deep-linked node is ABSENT from the seed, present only after the
    // primary's lineage getters settle.
    const seed = fixtureNodes(); // no late.view
    await installCatalogForTest(lateNodePrimary(), fixtureFallback(seed));

    renderAt(["/project/proj-1/view/late.view"]);

    // Once the layout loader's microtask resolves, the route renders its
    // bounded-pending skeleton (the node isn't in the catalog yet) — no crash.
    expect(await screen.findByTestId("model-detail-skeleton")).toBeTruthy();

    // After the SWR commit lands, the resolved ModelDetail renders (assert on
    // the friendly name, unique to <ModelDetail>'s header).
    await waitFor(() => {
      expect(screen.getByText("Late View")).toBeTruthy();
    });
  });
});

describe("workspace view mode (?view= in router history)", () => {
  it("defaults to Flow with no view param", async () => {
    const { router } = renderAt(["/project/proj-1"]);
    await screen.findByText("Pipeline");
    expect(router.state.location.search).toBe("");
    // Flow (dag) is shown — the audit-view "AI edits" marker is absent.
    expect(screen.queryByText(/AI edits/)).toBeNull();
  });

  it("renders the Audit view from a ?view=audit deep-link", async () => {
    renderAt(["/project/proj-1?view=audit"]);
    // The "AI edits" trail label is unique to the audit view.
    expect((await screen.findAllByText(/AI edits/)).length).toBeGreaterThan(0);
  });

  it("toggling a mode pushes a history entry that back/forward restores", async () => {
    const { router } = renderAt(["/project/proj-1"]);
    await screen.findByText("Pipeline");

    // Selecting Audit sets ?view=audit and switches the canvas.
    await act(async () => {
      screen.getByRole("button", { name: "Audit" }).click();
    });
    await waitFor(() =>
      expect(router.state.location.search).toBe("?view=audit"),
    );
    expect((await screen.findAllByText(/AI edits/)).length).toBeGreaterThan(0);

    // Selecting Flow (the default) drops the param for a clean URL.
    await act(async () => {
      screen.getByRole("button", { name: "Flow" }).click();
    });
    await waitFor(() => expect(router.state.location.search).toBe(""));

    // Back restores the audit view — the toggle is part of history.
    await act(async () => {
      await router.navigate(-1);
    });
    await waitFor(() =>
      expect(router.state.location.search).toBe("?view=audit"),
    );
    expect((await screen.findAllByText(/AI edits/)).length).toBeGreaterThan(0);
  });
});

describe("not-found (bounded resolver)", () => {
  it("flips to NodeNotFound once the resolve bound elapses", async () => {
    // A primary that rejects: the deep-linked node never lands.
    const rejectingPrimary: PartialCatalogSource = {
      getNodes: () => Promise.reject(new Error("backend down")),
      getEdges: () => Promise.reject(new Error("backend down")),
      getAudit: () => Promise.reject(new Error("backend down")),
    };
    const seed = fixtureNodes(); // no "ghost"
    await installCatalogForTest(rejectingPrimary, fixtureFallback(seed));

    vi.useFakeTimers();
    renderAt(["/project/proj-1/view/ghost"]);

    // Flush the loader + initial render (a loader route defers its first paint;
    // under fake timers, an act-wrapped 0-advance pumps React's scheduler) so the
    // bounded-pending skeleton shows — the node never lands (the primary rejects).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("model-detail-skeleton")).toBeTruthy();

    // …then the bound elapses → not-found, not an infinite spinner.
    await vi.advanceTimersByTimeAsync(8001);
    expect(screen.getByTestId("node-not-found")).toBeTruthy();
    expect(screen.queryByTestId("model-detail-skeleton")).toBeNull();
  });
});
