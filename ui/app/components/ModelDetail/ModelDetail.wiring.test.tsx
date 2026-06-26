// @vitest-environment happy-dom
//
// Component-wiring specs for the S5 catalog mutations under the amended ADR-034
// (idiomatic RRv7 for catalog data). Each mutation with a ModelDetail UI entry —
// dataset display-name rename, model_name change, audit toggle — must submit via
// an RRv7 `useFetcher` to its same-origin `/ui-server/*` action route, NOT call
// the imperative `catalog.*` write-through. On success RRv7 auto-revalidates the
// active loaders; pessimistic-by-default. (View/report rename has no ModelDetail
// entry point today — see the note below.)
//
// IF YOU'RE AN AGENT, READ THIS: these are the spec. They are RED until the
// ModelDetail call sites are rewired off `catalog.renameSource/setModelName/
// toggleAudit` onto fetcher submissions. Do NOT weaken them to match the current
// imperative-catalog behaviour — turn them green by moving the wiring.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createMemoryRouter,
  type RouteObject,
  RouterProvider,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuditEntry, LineageNode } from "../../catalog";
import { fixtureFallback } from "../../routes/_fixtureCatalog";
import { TestProviders } from "../../routes/_testRoutes";
import { catalog, installCatalogForTest, selectProject } from "../useCatalog";
import { ModelDetail } from "./ModelDetail";

afterEach(() => vi.restoreAllMocks());

/** d1 carries one transform-type audit entry (toggleable) so AuditPanel renders
 *  a switch. */
function fallbackWithAudit(): ReturnType<typeof fixtureFallback> {
  const base = fixtureFallback();
  const audit: Record<string, AuditEntry[]> = {
    d1: [
      {
        tool: "trimWhitespace",
        say: "Trimmed whitespace on email",
        tag: "clean",
        auditEntryId: "ae-tx",
        transformId: "t1",
        enabled: true,
      },
    ],
  };
  return { ...base, getAudit: () => Promise.resolve(audit) };
}

type Captured = {
  method: string;
  params: Record<string, string | undefined>;
  body: unknown;
};

/** Renders <ModelDetail> for `nodeId` inside a memory router that carries the
 *  four /ui-server action routes as capturing spies. A fetcher submission from
 *  the component is routed to the matching action and recorded; an untouched
 *  action stays `undefined` (the RED state while the call site is still
 *  imperative). */
async function renderDetailInRouter(nodeId: string) {
  await installCatalogForTest({}, fallbackWithAudit());
  await act(async () => {
    await selectProject("proj-1");
  });

  const captured: Record<string, Captured | undefined> = {};
  const spyAction =
    (key: string) =>
    async ({
      request,
      params,
    }: {
      request: Request;
      params: Record<string, string | undefined>;
    }) => {
      captured[key] = {
        method: request.method,
        params,
        body: await request.json().catch(() => undefined),
      };
      return Response.json({});
    };

  const node: LineageNode = catalog.getNode(nodeId)!;
  const routes: RouteObject[] = [
    { path: "/host", element: <ModelDetail node={node} onOpen={vi.fn()} /> },
    {
      path: "/ui-server/datasets/:datasetId",
      action: spyAction("dataset"),
    },
    {
      path: "/ui-server/projects/:projectId/views/:viewId",
      action: spyAction("view"),
    },
    {
      path: "/ui-server/projects/:projectId/reports/:reportId",
      action: spyAction("report"),
    },
    {
      path: "/ui-server/projects/:projectId/audit/:auditEntryId",
      action: spyAction("audit"),
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: ["/host"] });
  render(
    <TestProviders>
      <RouterProvider router={router} />
    </TestProviders>,
  );
  return { captured };
}

/** The clickable header name (the div whose text is the dataset label). */
function detName(label: string): HTMLElement {
  return screen
    .getAllByText(label)
    .find((el) => el.className.includes("detName"))!;
}

describe("ModelDetail wiring — dataset display-name rename", () => {
  it("submits the rename via a PATCH fetcher to /ui-server/datasets/:datasetId, not catalog.renameSource", async () => {
    const { captured } = await renderDetailInRouter("d1");
    const renameSpy = vi.spyOn(catalog, "renameSource").mockResolvedValue();
    await waitFor(() => expect(detName("stg_customers")).toBeTruthy());

    await act(async () => {
      detName("stg_customers").click();
    });
    const input = screen.getByLabelText("Edit dataset name") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "Customers" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => expect(captured.dataset).toBeDefined());
    expect(captured.dataset).toMatchObject({
      method: "PATCH",
      params: { datasetId: "d1" },
      body: { display_name: "Customers" },
    });
    expect(renameSpy).not.toHaveBeenCalled();
  });
});

// Note: view/report rename has no dedicated UI entry point in ModelDetail today
// (DetName is editable for datasets only). The view/report `/ui-server/*` rename
// ACTIONS are covered by the route-action tests; a component-wiring spec for them
// belongs with whatever UI entry DC-100 introduces, not here.

describe("ModelDetail wiring — model_name change", () => {
  it("submits the model_name via a PATCH fetcher to /ui-server/datasets/:datasetId after confirming, not catalog.setModelName", async () => {
    const { captured } = await renderDetailInRouter("d1");
    const setModelNameSpy = vi
      .spyOn(catalog, "setModelName")
      .mockResolvedValue();
    const subheader = () =>
      screen
        .getAllByText("stg_customers")
        .find((el) => el.className.includes("detFriendly"))!;
    await waitFor(() => expect(subheader()).toBeTruthy());

    await act(async () => {
      subheader().click();
    });
    const input = screen.getByLabelText(
      "Edit dataset machine name",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "warm_leads" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await act(async () => {
      screen.getByRole("button", { name: /change machine name/i }).click();
    });

    await waitFor(() => expect(captured.dataset).toBeDefined());
    expect(captured.dataset).toMatchObject({
      method: "PATCH",
      params: { datasetId: "d1" },
      body: { model_name: "warm_leads" },
    });
    expect(setModelNameSpy).not.toHaveBeenCalled();
  });
});

describe("ModelDetail wiring — audit toggle", () => {
  it("submits the toggle via a PATCH fetcher to /ui-server/projects/:projectId/audit/:auditEntryId, not catalog.toggleAudit", async () => {
    const { captured } = await renderDetailInRouter("d1");
    const toggleSpy = vi.spyOn(catalog, "toggleAudit").mockResolvedValue();
    await waitFor(() =>
      expect(screen.getByText("Trimmed whitespace on email")).toBeTruthy(),
    );

    await act(async () => {
      screen.getByRole("switch").click();
    });

    await waitFor(() => expect(captured.audit).toBeDefined());
    expect(captured.audit).toMatchObject({
      method: "PATCH",
      params: { projectId: "proj-1", auditEntryId: "ae-tx" },
      body: { enabled: false },
    });
    expect(toggleSpy).not.toHaveBeenCalled();
  });
});
