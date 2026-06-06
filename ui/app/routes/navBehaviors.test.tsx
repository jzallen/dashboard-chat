// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearAll, setToken } from "../auth/tokenStorage";
import type { Edge, LineageNode, PartialCatalogSource } from "../catalog";
import { installCatalogForTest } from "../components/useCatalog";
import {
  fixtureFallback,
  fixtureNodes,
  NO_PRIMARY,
} from "./_fixtureCatalog";
import { TestProviders, testRouteTree } from "./_testRoutes";

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

afterEach(() => clearAll());

describe("history navigation", () => {
  it("a project switch PUSHes history and navigate(-1) returns to the prior project", async () => {
    // Start on proj-1's workspace.
    const { router } = renderAt(["/project/proj-1"]);
    await screen.findByText("Pipeline");

    // Drive the production ProjectPicker in the Topbar: open it, pick proj-2.
    // The picker calls intents.selectProject, which now PUSHes (project is a
    // navigable route, not a filter), so Back traverses projects.
    fireEvent.click(screen.getByText("Primary Project"));
    fireEvent.click(await screen.findByText("Second Project"));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/project/proj-2");
    });
    expect(router.state.historyAction).toBe("PUSH");

    // Back returns to the prior project, not out of the app.
    router.navigate(-1);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/project/proj-1");
    });
  });

  it("Back restores the prior route after opening a model", async () => {
    const { router } = renderAt(["/project/proj-1"]);
    await screen.findByText("Pipeline");

    // Push a model route (a real history entry).
    router.navigate("/project/proj-1/view/v1");
    await screen.findByText("Active Customers");

    // Back returns to the workspace, not out of the app.
    router.navigate(-1);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/project/proj-1");
    });
    expect(await screen.findByText("Pipeline")).toBeTruthy();
  });
});

describe("Topbar pending guard", () => {
  it("does not crash when a deep-linked model node is not yet in the catalog", async () => {
    // No primary, node absent from the seed → catalog.getNode is undefined.
    // The Topbar breadcrumb must fall back to the project picker, not deref a
    // null node (the old RouteFrame/Topbar route.node! crash sites).
    renderAt(["/project/proj-1/view/never-loaded"]);
    // The shell rendered (the upload action button is part of the Topbar) and
    // the resource route shows its skeleton — no throw.
    expect(await screen.findByTitle("Upload a source")).toBeTruthy();
    expect(screen.getByTestId("model-detail-skeleton")).toBeTruthy();
  });
});

describe("per-project working state", () => {
  it("a dataset rename does not leak across a project switch", async () => {
    // A project-scoped primary: each project resolves a distinct one-node graph.
    const graphs: Record<string, Record<string, LineageNode>> = {
      "proj-1": {
        "p1.ds": {
          id: "p1.ds",
          label: "p1_dataset",
          sub: "staging dataset",
          layer: "staging",
          ref: {
            kind: "dataset",
            name: "P1 Dataset",
            model: "p1_dataset",
            rows: 0,
            fields: [],
            preview: [],
            transforms: [],
            sql: "select 1",
          },
        },
      },
      "proj-2": {
        "p2.ds": {
          id: "p2.ds",
          label: "p2_dataset",
          sub: "staging dataset",
          layer: "staging",
          ref: {
            kind: "dataset",
            name: "P2 Dataset",
            model: "p2_dataset",
            rows: 0,
            fields: [],
            preview: [],
            transforms: [],
            sql: "select 1",
          },
        },
      },
    };
    // The scoped pid is what the layout loader sets via selectProject; the source
    // reads it through the module holder, which installCatalogForTest resets.
    let scoped = "proj-1";
    const primary: PartialCatalogSource = {
      getCurrentProject: () =>
        Promise.resolve({ id: scoped, name: scoped, description: "" }),
      getNodes: () =>
        new Promise((resolve) => setTimeout(() => resolve(graphs[scoped]), 0)),
      getEdges: () => new Promise((resolve) => setTimeout(() => resolve([] as Edge[]), 0)),
      getAudit: () => new Promise((resolve) => setTimeout(() => resolve({}), 0)),
    };
    await installCatalogForTest(primary, fixtureFallback(fixtureNodes()));

    const { router } = renderAt(["/project/proj-1"]);
    await screen.findByText("Pipeline");

    // Wait for p1's graph to commit, then rename p1's dataset.
    const { catalog } = await import("../components/useCatalog");
    await waitFor(() => expect(catalog.getNode("p1.ds")).toBeDefined());
    catalog.renameSource("p1.ds", "renamed_in_p1");
    expect(catalog.getNode("p1.ds")?.label).toBe("renamed_in_p1");

    // Switch to proj-2: the loader re-scopes, building a fresh graph.
    scoped = "proj-2";
    router.navigate("/project/proj-2");
    await waitFor(() => expect(catalog.getNode("p2.ds")).toBeDefined());

    // p1's node (and its rename) is gone — working state did not leak.
    expect(catalog.getNode("p1.ds")).toBeUndefined();
    expect(catalog.getNode("p2.ds")?.label).toBe("p2_dataset");
  });
});
