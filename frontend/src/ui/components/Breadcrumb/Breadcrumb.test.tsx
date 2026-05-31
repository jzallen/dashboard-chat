// Acceptance scenarios for the breadcrumb navigation shell (MR-3).
//
// Authored RED by DISTILL (path-forward.md §4.1). The breadcrumb replaces the
// SideNav: it is route-context-aware (list/pipeline → `OrgIcon / Project ▾`;
// model detail → `OrgIcon / Project (link) / Model ▾`), its pickers search and
// navigate (project → MR-2 Pipeline landing; model → the chosen model's detail),
// the org icon toggles the Org Settings sheet via a linkable `?org=1` search param
// (morphing to an × and hiding project affordances), and a minimal utility menu
// keeps /sessions + /query-engines reachable until MR-4.
//
// Picker data is mocked at the dataCatalog query-hook boundary (the data port — NOT
// ui-state, mirrors PipelineLanding.test). Route params + navigation are exercised
// through createRoutesStub so the crumbs prove they are wired to the URL, and a
// picker selection proves it actually navigates (the destination re-renders the
// breadcrumb in the new context).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Breadcrumb } from "./index";

// ─────────────────────── port-boundary doubles (data hooks) ───────────────────────

const projects = [
  { id: "p1", name: "Alpha", description: null, created_at: "", updated_at: "" },
  { id: "p2", name: "Beta", description: null, created_at: "", updated_at: "" },
];

const datasetsForProject: Record<string, unknown[]> = {
  p1: [
    {
      id: "d1",
      name: "orders",
      link: "/api/datasets/d1",
      description: null,
      schema_config: { fields: {} },
    },
  ],
};
const viewsForProject: Record<string, unknown[]> = {
  p1: [{ id: "v1", name: "int_revenue", project_id: "p1" }],
};
const reportsForProject: Record<string, unknown[]> = {
  p1: [{ id: "r1", name: "fct_sales", project_id: "p1" }],
};

const viewDetail: Record<string, unknown> = {
  v1: { id: "v1", name: "int_revenue", project_id: "p1" },
};
const reportDetail: Record<string, unknown> = {
  r1: { id: "r1", name: "fct_sales", project_id: "p1" },
};
const datasetDetail: Record<string, unknown> = {
  d1: { id: "d1", name: "orders", project_id: "p1" },
};

vi.mock("../../hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({ data: { id: "org-1", name: "Acme" } }),
  useOrgProjectsQuery: () => ({ data: projects }),
}));
vi.mock("../../hooks/useDatasetQuery", () => ({
  useDatasets: (projectId: string | undefined) => ({
    data: datasetsForProject[projectId ?? ""] ?? [],
    isLoading: false,
  }),
  useDatasetQuery: (datasetId: string | undefined) => ({
    data: datasetId ? datasetDetail[datasetId] : undefined,
    isLoading: false,
  }),
}));
vi.mock("../../hooks/useViewQuery", () => ({
  useViewsQuery: (projectId: string | undefined) => ({
    data: viewsForProject[projectId ?? ""] ?? [],
    isLoading: false,
  }),
  useViewQuery: (viewId: string | undefined) => ({
    data: viewId ? viewDetail[viewId] : undefined,
    isLoading: false,
  }),
}));
vi.mock("../../hooks/useReportQuery", () => ({
  useReportsQuery: (projectId: string | undefined) => ({
    data: reportsForProject[projectId ?? ""] ?? [],
    isLoading: false,
  }),
  useReportQuery: (reportId: string | undefined) => ({
    data: reportId ? reportDetail[reportId] : undefined,
    isLoading: false,
  }),
}));

const resetSession = vi.fn();
vi.mock("../../context/ChatContext", () => ({
  useChatContext: () => ({ resetSession }),
}));

afterEach(() => {
  cleanup();
  resetSession.mockClear();
});

// ─────────────────────────────── render harness ───────────────────────────────

function renderBreadcrumbAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const Harness = () => <Breadcrumb />;
  const Stub = createRoutesStub([
    { path: "projects/:projectId/pipeline", Component: Harness },
    { path: "view/:viewId", Component: Harness },
    { path: "report/:reportId", Component: Harness },
    { path: "table/:datasetId", Component: Harness },
    { path: "/", Component: Harness },
    { path: "sessions", Component: () => <div data-testid="dest-sessions" /> },
    {
      path: "query-engines",
      Component: () => <div data-testid="dest-query-engines" />,
    },
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <Stub initialEntries={[path]} />
    </QueryClientProvider>,
  );
}

// ─────────────────────────────── scenarios ───────────────────────────────

describe("Breadcrumb — route-context-aware crumbs", () => {
  it("renders the org icon and a project crumb (no model crumb) on a pipeline/list route", async () => {
    renderBreadcrumbAt("/projects/p1/pipeline");

    expect(await screen.findByTestId("breadcrumb-org-icon")).toBeInTheDocument();
    expect(screen.getByTestId("project-crumb")).toHaveTextContent("Alpha");
    expect(screen.queryByTestId("model-crumb")).toBeNull();
  });

  it("renders org icon, a project link, and a model crumb on a model-detail route", async () => {
    renderBreadcrumbAt("/view/v1");

    expect(await screen.findByTestId("breadcrumb-org-icon")).toBeInTheDocument();
    // Project resolved from the model's project_id (the route has no projectId param).
    expect(screen.getByTestId("project-crumb-link")).toHaveTextContent("Alpha");
    expect(screen.getByTestId("model-crumb")).toHaveTextContent("int_revenue");
  });
});

describe("Breadcrumb — project picker", () => {
  it("filters projects by name and navigates to the selected project's pipeline landing", async () => {
    renderBreadcrumbAt("/projects/p1/pipeline");

    fireEvent.click(await screen.findByTestId("project-crumb"));
    const search = await screen.findByTestId("project-picker-search");
    expect(screen.getByTestId("project-option-p2")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Bet" } });
    expect(screen.queryByTestId("project-option-p1")).toBeNull();
    expect(screen.getByTestId("project-option-p2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("project-option-p2"));

    // Navigated to /projects/p2/pipeline — the breadcrumb re-renders in the new
    // context with the picker closed and the new project shown.
    expect(await screen.findByTestId("project-crumb")).toHaveTextContent("Beta");
    expect(screen.queryByTestId("project-picker-search")).toBeNull();
  });
});

describe("Breadcrumb — model picker", () => {
  it("groups datasets/views/reports, searches across them, and navigates to the chosen model", async () => {
    renderBreadcrumbAt("/view/v1");

    fireEvent.click(await screen.findByTestId("model-crumb"));
    const search = await screen.findByTestId("model-picker-search");
    expect(screen.getByTestId("model-group-datasets")).toBeInTheDocument();
    expect(screen.getByTestId("model-group-views")).toBeInTheDocument();
    expect(screen.getByTestId("model-group-reports")).toBeInTheDocument();
    expect(screen.getByTestId("model-option-d1")).toBeInTheDocument();
    expect(screen.getByTestId("model-option-r1")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "fct" } });
    expect(screen.queryByTestId("model-option-d1")).toBeNull();
    expect(screen.queryByTestId("model-option-v1")).toBeNull();
    expect(screen.getByTestId("model-option-r1")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("model-option-r1"));

    // Navigated to /report/r1 — breadcrumb re-renders showing the report as the model.
    expect(await screen.findByTestId("model-crumb")).toHaveTextContent("fct_sales");
  });
});

describe("Breadcrumb — org settings toggle (?org=1)", () => {
  it("derives the open state from the linkable ?org=1 param: morphs to a close control and hides project affordances", async () => {
    renderBreadcrumbAt("/projects/p1/pipeline?org=1");

    const orgIcon = await screen.findByTestId("breadcrumb-org-icon");
    expect(orgIcon).toHaveAttribute("aria-label", "Close org settings");
    // Project-scoped affordances are hidden while the org sheet is open.
    expect(screen.queryByTestId("project-crumb")).toBeNull();
  });

  it("toggles the org sheet open and closed when the org icon is clicked", async () => {
    renderBreadcrumbAt("/projects/p1/pipeline");

    const orgIcon = await screen.findByTestId("breadcrumb-org-icon");
    expect(orgIcon).toHaveAttribute("aria-label", "Open org settings");
    expect(screen.getByTestId("project-crumb")).toBeInTheDocument();

    fireEvent.click(orgIcon);
    expect(await screen.findByTestId("breadcrumb-org-icon")).toHaveAttribute(
      "aria-label",
      "Close org settings",
    );
    expect(screen.queryByTestId("project-crumb")).toBeNull();

    fireEvent.click(screen.getByTestId("breadcrumb-org-icon"));
    expect(await screen.findByTestId("breadcrumb-org-icon")).toHaveAttribute(
      "aria-label",
      "Open org settings",
    );
    expect(screen.getByTestId("project-crumb")).toBeInTheDocument();
  });
});

describe("Breadcrumb — utility menu keeps non-breadcrumb routes reachable (anti-strand, interim until MR-4)", () => {
  it("navigates to All Chats (/sessions) from the utility menu", async () => {
    renderBreadcrumbAt("/projects/p1/pipeline");

    fireEvent.click(await screen.findByTestId("breadcrumb-utility"));
    fireEvent.click(await screen.findByTestId("utility-sessions"));

    expect(await screen.findByTestId("dest-sessions")).toBeInTheDocument();
  });

  it("navigates to Query Engines (/query-engines) from the utility menu", async () => {
    renderBreadcrumbAt("/projects/p1/pipeline");

    fireEvent.click(await screen.findByTestId("breadcrumb-utility"));
    fireEvent.click(await screen.findByTestId("utility-query-engines"));

    expect(await screen.findByTestId("dest-query-engines")).toBeInTheDocument();
  });

  it("resets the chat session and returns to the index on New Session", async () => {
    renderBreadcrumbAt("/projects/p1/pipeline");

    fireEvent.click(await screen.findByTestId("breadcrumb-utility"));
    fireEvent.click(await screen.findByTestId("utility-new-session"));

    expect(resetSession).toHaveBeenCalledTimes(1);
  });
});
