// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installCatalogForTest } from "../../src/app/useCatalog";
import { clearAll, setToken } from "../../src/auth/tokenStorage";
import { fixtureFallback, NO_PRIMARY } from "./_fixtureCatalog";
import { TestProviders,testRouteTree } from "./_testRoutes";

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
  it("a project switch replaces history (length unchanged) and reflects ?project=", async () => {
    // Start on the workspace already viewing proj-1.
    const { router } = renderAt(["/?project=proj-1"]);
    await screen.findByText("Pipeline");
    const before = router.state.location;

    // Drive the production ProjectPicker in the Topbar: open it, pick proj-2.
    // The picker calls intents.selectProject, which navigates with replace:true.
    fireEvent.click(screen.getByText("Primary Project"));
    fireEvent.click(await screen.findByText("Second Project"));

    await waitFor(() => {
      expect(
        new URLSearchParams(router.state.location.search).get("project"),
      ).toBe("proj-2");
    });
    // Replace, not push: the history index did not advance.
    expect(router.state.historyAction).toBe("REPLACE");
    expect(router.state.location.pathname).toBe(before.pathname);
  });

  it("Back restores the prior route after opening a model", async () => {
    const { router } = renderAt(["/"]);
    await screen.findByText("Pipeline");

    // Push a model route (a real history entry).
    router.navigate("/view/v1");
    await screen.findByText("Active Customers");

    // Back returns to the workspace, not out of the app.
    router.navigate(-1);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(await screen.findByText("Pipeline")).toBeTruthy();
  });
});

describe("Topbar pending guard", () => {
  it("does not crash when a deep-linked model node is not yet in the catalog", async () => {
    // No primary, node absent from the seed → catalog.getNode is undefined.
    // The Topbar breadcrumb must fall back to the project picker, not deref a
    // null node (the old RouteFrame/Topbar route.node! crash sites).
    renderAt(["/view/never-loaded"]);
    // The shell rendered (the upload action button is part of the Topbar) and
    // the resource route shows its skeleton — no throw.
    expect(await screen.findByTitle("Upload a source")).toBeTruthy();
    expect(screen.getByTestId("model-detail-skeleton")).toBeTruthy();
  });
});
