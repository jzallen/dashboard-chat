// @vitest-environment happy-dom
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installCatalogForTest } from "../../src/app/useCatalog";
import { clearAll,setToken } from "../../src/auth/tokenStorage";
import type { LineageNode, PartialCatalogSource } from "../../src/lib/catalog";
import {
  fixtureFallback,
  fixtureNodes,
  NO_PRIMARY,
} from "./_fixtureCatalog";
import { TestProviders,testRouteTree } from "./_testRoutes";

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
  it("renders the view ModelDetail for /view/v1", async () => {
    renderAt(["/view/v1"]);
    // The friendly model name (m.name) is unique to <ModelDetail>'s header
    // (the node label also appears in the Topbar breadcrumb).
    expect(await screen.findByText("Active Customers")).toBeTruthy();
  });

  it("renders the dataset ModelDetail for /table/d1", async () => {
    renderAt(["/table/d1"]);
    expect(await screen.findByText("Customers (staging)")).toBeTruthy();
  });

  it("renders the report ModelDetail for /report/r1", async () => {
    renderAt(["/report/r1"]);
    expect(await screen.findByText("Revenue Fact")).toBeTruthy();
  });

  it("renders the workspace at /", async () => {
    renderAt(["/"]);
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
    return {
      getNodes: () =>
        new Promise((resolve) => setTimeout(() => resolve(nodes), 0)),
      getEdges: () => new Promise((resolve) => setTimeout(() => resolve([]), 0)),
      getAudit: () => new Promise((resolve) => setTimeout(() => resolve({}), 0)),
    };
  }

  it("shows the skeleton synchronously, then ModelDetail after the catalog revalidates", async () => {
    // The deep-linked node is ABSENT from the seed, present only after the
    // primary's lineage getters settle.
    const seed = fixtureNodes(); // no late.view
    await installCatalogForTest(lateNodePrimary(), fixtureFallback(seed));

    renderAt(["/view/late.view"]);

    // Synchronously: the bounded-pending skeleton, no crash on a missing node.
    expect(screen.getByTestId("model-detail-skeleton")).toBeTruthy();

    // After the SWR commit lands, the resolved ModelDetail renders (assert on
    // the friendly name, unique to <ModelDetail>'s header).
    await waitFor(() => {
      expect(screen.getByText("Late View")).toBeTruthy();
    });
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
    renderAt(["/view/ghost"]);

    // Pending first…
    expect(screen.getByTestId("model-detail-skeleton")).toBeTruthy();

    // …then the bound elapses → not-found, not an infinite spinner.
    await vi.advanceTimersByTimeAsync(8001);
    expect(screen.getByTestId("node-not-found")).toBeTruthy();
    expect(screen.queryByTestId("model-detail-skeleton")).toBeNull();
  });
});
