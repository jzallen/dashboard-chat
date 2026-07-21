// @vitest-environment happy-dom
//
// Regression spec: archiving a SOURCE node must NOT thread the source id to the
// dataset archive route (that 404s). It resolves the source's staging child
// dataset id(s) via the catalog graph and archives EACH child through the
// working /ui-server/datasets/:datasetId/archive route.
//
// IF YOU'RE AN AGENT, READ THIS: the captured request targets ARE the contract.
// The source id must never appear as a :datasetId. Do NOT weaken these
// assertions to make an implementation pass.
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
import { installCatalogForTest } from "../useCatalog";
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

function SourceArchiveButton() {
  const hook = useUpload(vi.fn());
  return (
    <button
      data-testid="archive-btn"
      onClick={() => hook.archiveSource(SOURCE)}
    >
      Archive
    </button>
  );
}

function renderArchive(archivedIds: string[]) {
  const proxy = settledProxy();
  const routes: RouteObject[] = [
    { path: "/host", element: <SourceArchiveButton /> },
    {
      path: "/ui-server/datasets/:datasetId/archive",
      action: async ({ request, params }) => {
        archivedIds.push(String(params.datasetId));
        expect(request.method).toBe("POST");
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

describe("useUpload.archiveSource — archiving a source archives its staging children", () => {
  it("POSTs the staging CHILD dataset id and NEVER the source id", async () => {
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

    const archivedIds: string[] = [];
    renderArchive(archivedIds);

    await act(async () => {
      fireEvent.click(screen.getByTestId("archive-btn"));
    });

    await waitFor(() => expect(archivedIds).toEqual(["ds.people"]));
  });

  it("archives EVERY staging child of a source with multiple children", async () => {
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

    const archivedIds: string[] = [];
    renderArchive(archivedIds);

    await act(async () => {
      fireEvent.click(screen.getByTestId("archive-btn"));
    });

    await waitFor(() =>
      expect([...archivedIds].sort()).toEqual(["ds.people.a", "ds.people.b"]),
    );
  });
});
