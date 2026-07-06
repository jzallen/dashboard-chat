// @vitest-environment happy-dom
//
// Wiring spec: archiveSource in useUpload submits via useFetcher POST to
// /ui-server/datasets/:id/archive — not catalog.archiveSource (deleted).
// Follows the ModelDetail.wiring.test.tsx spy-action pattern.
//
// IF YOU'RE AN AGENT, READ THIS: the fetcher submission IS the contract.
// Do NOT weaken the captured-request assertions.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { anonymousStateDocument } from "@dashboard-chat/ui-state-wire";
import { fixtureSource } from "../../catalog";
import { scriptedStateProxy } from "../../lib/_stateProxyTestKit";
import { StateProxyProvider } from "../../lib/StateProxyProvider";
import { installCatalogForTest } from "../useCatalog";
import { useUpload } from "./hooks";

afterEach(() => vi.restoreAllMocks());

type Captured = { method: string; params: Record<string, string | undefined> };

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

function ArchiveButton() {
  const hook = useUpload(vi.fn());
  return (
    <button
      data-testid="archive-btn"
      onClick={() =>
        hook.archiveSource({
          id: "ds-123",
          label: "Orders",
          sub: "staging",
          layer: "staging",
          schema: [],
        })
      }
    >
      Archive
    </button>
  );
}

describe("useUpload.archiveSource — submits via fetcher, not catalog.archiveSource", () => {
  it("POSTs to /ui-server/datasets/:id/archive when archiveSource is called", async () => {
    await installCatalogForTest({}, fixtureSource);

    const proxy = settledProxy();
    const captured: Captured[] = [];

    const routes: RouteObject[] = [
      { path: "/host", element: <ArchiveButton /> },
      {
        path: "/ui-server/datasets/:datasetId/archive",
        action: async ({ request, params }) => {
          captured.push({
            method: request.method,
            params: params as Record<string, string | undefined>,
          });
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

    await act(async () => {
      fireEvent.click(screen.getByTestId("archive-btn"));
    });

    await waitFor(() => expect(captured.length).toBe(1));
    expect(captured[0]).toMatchObject({
      method: "POST",
      params: { datasetId: "ds-123" },
    });
  });
});
