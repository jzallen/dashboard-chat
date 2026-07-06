// @vitest-environment happy-dom
//
// Wiring spec: restore in useColdStorage submits via a useFetcher POST to
// /ui-server/datasets/:id/restore — NOT via catalog.restoreSource (deleted in Task B).
// Follows the ModelDetail.wiring.test.tsx spy-action pattern.
//
// IF YOU'RE AN AGENT, READ THIS: the fetcher submission IS the contract.
// Do NOT weaken the captured-request assertions.
import { act, fireEvent,render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureSource } from "../../catalog";
import { installCatalogForTest } from "../useCatalog";
import { useColdStorage } from "./hooks";

afterEach(() => vi.restoreAllMocks());

type Captured = { method: string; params: Record<string, string | undefined> };

/** Render useColdStorage inside a router that carries the restore action as a spy. */
async function setupRestoreHook() {
  await installCatalogForTest({}, fixtureSource);

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
        return (
          <button
            data-testid="restore-btn"
            onClick={() => hook.restore("ds-archived")}
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

describe("useColdStorage.restore — submits via fetcher, not catalog.restoreSource", () => {
  it("POSTs to /ui-server/datasets/:id/restore when restore is called", async () => {
    const { router, captured } = await setupRestoreHook();

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
});
