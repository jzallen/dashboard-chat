// @vitest-environment happy-dom
//
// Wiring spec: restore in useColdStorage is routed by the retired node's entity.
//   - A server-archived DATASET restores via a useFetcher POST to
//     /ui-server/datasets/:id/restore (the backend clears `archived_at`).
//   - A client-archived SOURCE restores LOCALLY through the catalog graph and
//     must NOT hit the backend (a source id is not a dataset id — it would 404).
//
// IF YOU'RE AN AGENT, READ THIS: the routing IS the contract — a dataset hits
// the fetcher, a source never does. Do NOT weaken these assertions.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogSource, LineageNode } from "../../catalog";
import { fixtureSource } from "../../catalog";
import { installCatalogForTest, useCatalogFromContext } from "../useCatalog";
import { useColdStorage } from "./hooks";

afterEach(() => vi.restoreAllMocks());

type Captured = { method: string; params: Record<string, string | undefined> };

/** Render useColdStorage inside a router that carries the restore action as a spy. */
async function setupRestoreHook(
  onClick: (hook: ReturnType<typeof useColdStorage>, catalog: ReturnType<typeof useCatalogFromContext>) => void,
  fallback: CatalogSource = fixtureSource,
) {
  await installCatalogForTest({}, fallback);

  const captured: Captured[] = [];
  const restoreAction = async ({
    request,
    params,
  }: {
    request: Request;
    params: Record<string, string | undefined>;
  }) => {
    captured.push({ method: request.method, params });
    return Response.json({});
  };

  const routes: RouteObject[] = [
    {
      path: "/host",
      Component: function Host() {
        const hook = useColdStorage();
        const catalog = useCatalogFromContext();
        return (
          <button
            data-testid="restore-btn"
            onClick={() => onClick(hook, catalog)}
          >
            Restore
          </button>
        );
      },
    },
    {
      path: "/ui-server/datasets/:datasetId/restore",
      action: restoreAction,
    },
  ];

  const router = createMemoryRouter(routes, { initialEntries: ["/host"] });
  return { router, captured };
}

describe("useColdStorage.restore — routes by entity", () => {
  it("POSTs a server-archived DATASET to /ui-server/datasets/:id/restore", async () => {
    const { router, captured } = await setupRestoreHook((hook) =>
      hook.restore("ds-archived"),
    );

    render(<RouterProvider router={router} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("restore-btn"));
    });

    await waitFor(() => expect(captured.length).toBe(1));
    expect(captured[0]).toMatchObject({
      method: "POST",
      params: { datasetId: "ds-archived" },
    });
  });

  it("restores a client-archived SOURCE locally, never touching the backend", async () => {
    const source: LineageNode = {
      id: "src.people",
      label: "people",
      sub: "source",
      layer: "source",
      schema: [{ name: "id", type: "integer" }],
    };
    const topology: CatalogSource = {
      ...fixtureSource,
      getNodes: () => Promise.resolve({ [source.id]: source }),
      getEdges: () => Promise.resolve([]),
      getAudit: () => Promise.resolve({}),
    };

    const { router, captured } = await setupRestoreHook((hook, catalog) => {
      // Archive the source client-side first, then restore it through the hook.
      catalog.archiveSource(source.id);
      hook.restore(source.id);
    }, topology);

    render(<RouterProvider router={router} />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("restore-btn"));
    });

    // The source is active again and no backend restore was ever submitted.
    await waitFor(() => expect(captured).toEqual([]));
  });
});
