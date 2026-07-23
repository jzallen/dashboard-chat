// @vitest-environment happy-dom
//
// Regression spec: archiving a SOURCE node is a CLIENT-ONLY lineage update. It
// must NOT post anything to the backend (no source id threaded to the dataset
// archive route — that 404s — and no cascading dataset archive). The source
// moves into the working graph's cold storage and its connected staging
// dataset(s) render disabled-but-visible; the dataset archive route is never hit.
//
// IF YOU'RE AN AGENT, READ THIS: "no backend request fired" IS the contract.
// The dataset archive action must never run. Do NOT weaken these assertions to
// make an implementation pass.
import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogSource, Edge, LineageNode } from "../../catalog";
import { fixtureSource } from "../../catalog";
import { scriptedStateProxy } from "../../lib/_stateProxyTestKit";
import { StateProxyProvider } from "../../lib/StateProxyProvider";
import {
  installCatalogForTest,
  useCatalogFromContext,
  useCatalogVersion,
} from "../useCatalog";
import { useUpload } from "./hooks";

afterEach(() => vi.restoreAllMocks());

function settledProxy() {
  const base = anonymousStateDocument();
  const doc = {
    ...base,
    phase: "chat" as const,
    sequence_id: base.sequence_id + 1,
    regions: {
      ...base.regions,
      onboarding: { ...base.regions.onboarding, state: "ready" as const },
    },
  };
  return scriptedStateProxy(doc, () => doc).proxy;
}

/** A CatalogSource fallback with a known source→staging topology so the hook can
 *  resolve the source's staging children through the live catalog graph. */
function topologySource(
  nodes: Record<string, LineageNode>,
  edges: Edge[],
): CatalogSource {
  return {
    ...fixtureSource,
    getNodes: () => Promise.resolve(nodes),
    getEdges: () => Promise.resolve(edges),
    getAudit: () => Promise.resolve({}),
  };
}

const SOURCE: LineageNode = {
  id: "src.people",
  label: "people",
  sub: "source",
  layer: "source",
  schema: [{ name: "id", type: "integer" }],
};

/** Renders the archive trigger alongside a live read-out of the catalog's cold
 *  storage + disabled-node derivations so the test asserts the client lineage
 *  update rather than any backend call. */
function SourceArchiveHarness() {
  const hook = useUpload(vi.fn());
  const catalog = useCatalogFromContext();
  useCatalogVersion(); // re-render on every catalog mutation
  return (
    <>
      <button
        data-testid="archive-btn"
        onClick={() => hook.archiveSource(SOURCE)}
      >
        Archive
      </button>
      <div data-testid="cold">
        {catalog
          .listColdStorage()
          .map((c) => c.id)
          .sort()
          .join(",")}
      </div>
      <div data-testid="disabled">
        {[...catalog.disabledNodes()].sort().join(",")}
      </div>
      <div data-testid="active-source">
        {catalog.getNode("src.people") ? "present" : "gone"}
      </div>
    </>
  );
}

function renderArchive(datasetRouteHits: string[]) {
  const proxy = settledProxy();
  const routes: RouteObject[] = [
    { path: "/host", element: <SourceArchiveHarness /> },
    {
      // A spy that records ANY hit — archiving a source must never reach it.
      path: "/ui-server/datasets/:datasetId/archive",
      action: async ({ params }) => {
        datasetRouteHits.push(String(params.datasetId));
        return Response.json({});
      },
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ["/host"] });
  render(
    <StateProxyProvider proxy={proxy}>
      <RouterProvider router={router} />
    </StateProxyProvider>,
  );
}

describe("useUpload.archiveSource — archiving a source is a client-only lineage update", () => {
  it("moves the source to cold storage and disables its staging child WITHOUT any backend request", async () => {
    const stg: LineageNode = {
      id: "ds.people",
      label: "people",
      sub: "staging",
      layer: "staging",
      ref: { kind: "dataset", fields: [] },
    };
    await installCatalogForTest(
      {},
      topologySource(
        { [SOURCE.id]: SOURCE, [stg.id]: stg },
        [[SOURCE.id, stg.id]],
      ),
    );

    const datasetRouteHits: string[] = [];
    renderArchive(datasetRouteHits);

    await act(async () => {
      fireEvent.click(screen.getByTestId("archive-btn"));
    });

    // Client lineage update: the source left the active DAG for cold storage…
    await waitFor(() =>
      expect(screen.getByTestId("cold").textContent).toBe("src.people"),
    );
    expect(screen.getByTestId("active-source").textContent).toBe("gone");
    // …and its staging child is now disabled-but-visible.
    expect(screen.getByTestId("disabled").textContent).toBe("ds.people");
    // The load-bearing guarantee: the dataset archive route was NEVER hit.
    expect(datasetRouteHits).toEqual([]);
  });

  it("never cascades a backend archive for a source feeding multiple staging datasets", async () => {
    const stgA: LineageNode = {
      id: "ds.people.a",
      label: "people-a",
      sub: "staging",
      layer: "staging",
      ref: { kind: "dataset", fields: [] },
    };
    const stgB: LineageNode = {
      id: "ds.people.b",
      label: "people-b",
      sub: "staging",
      layer: "staging",
      ref: { kind: "dataset", fields: [] },
    };
    await installCatalogForTest(
      {},
      topologySource(
        { [SOURCE.id]: SOURCE, [stgA.id]: stgA, [stgB.id]: stgB },
        [
          [SOURCE.id, stgA.id],
          [SOURCE.id, stgB.id],
        ],
      ),
    );

    const datasetRouteHits: string[] = [];
    renderArchive(datasetRouteHits);

    await act(async () => {
      fireEvent.click(screen.getByTestId("archive-btn"));
    });

    await waitFor(() =>
      expect(screen.getByTestId("disabled").textContent).toBe(
        "ds.people.a,ds.people.b",
      ),
    );
    expect(screen.getByTestId("cold").textContent).toBe("src.people");
    expect(datasetRouteHits).toEqual([]);
  });
});
