import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent,render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet,Route, Routes } from "react-router-dom";

import { MOCK_PROJECT } from "../../../__mocks__/data";
import type { AppShellContext } from "../../../lib/ui/components/AppShell";
import { ProjectView } from "../../../lib/ui/components/DatasetView";
import { ChatProvider } from "../../../lib/ui/context/ChatContext";

// Mock API calls — use dynamic import in factory to avoid hoisting issues
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  const { MOCK_DATASET_FULL, MOCK_PROJECT } = await import("../../../__mocks__/data");
  return {
    ...actual,
    getDataset: vi.fn().mockResolvedValue(MOCK_DATASET_FULL),
    getProject: vi.fn().mockResolvedValue(MOCK_PROJECT),
  };
});

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

/** Layout route that injects outlet context like AppShell does */
function ContextLayout() {
  const context: AppShellContext = {
    orgName: "Test Org",
    project: MOCK_PROJECT,
    projects: [MOCK_PROJECT],
  };
  return <Outlet context={context} />;
}

function renderProjectView(route = "/") {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[route]}>
        <ChatProvider>
          <Routes>
            <Route element={<ContextLayout />}>
              <Route path="/" element={<ProjectView />} />
              <Route
                path="/projects/:projectId/datasets/:datasetId"
                element={<ProjectView />}
              />
            </Route>
          </Routes>
        </ChatProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ProjectView", () => {
  describe("grid mode (no dataset selected)", () => {
    it("renders project name in breadcrumb", () => {
      renderProjectView("/");
      expect(screen.getByText("Inventory Dashboard")).toBeInTheDocument();
    });

    it("renders all dataset cards in wrapping grid", () => {
      renderProjectView("/");
      expect(screen.getByText("Sales Data")).toBeInTheDocument();
      expect(screen.getByText("Inventory")).toBeInTheDocument();
      expect(screen.getByText("Returns")).toBeInTheDocument();
    });

    it("does not show view mode toggle", () => {
      renderProjectView("/");
      expect(screen.queryByLabelText("Catalog view")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Table view")).not.toBeInTheDocument();
    });
  });

  describe("row mode (dataset selected)", () => {
    const datasetRoute = "/projects/proj-001/datasets/ds-001";

    it("renders dataset name in breadcrumb after loading", async () => {
      renderProjectView(datasetRoute);
      await screen.findByLabelText("Catalog view");
      const allSalesData = screen.getAllByText("Sales Data");
      expect(allSalesData.length).toBeGreaterThanOrEqual(1);
    });

    it("renders view mode toggle", async () => {
      renderProjectView(datasetRoute);
      expect(await screen.findByLabelText("Catalog view")).toBeInTheDocument();
      expect(screen.getByLabelText("Table view")).toBeInTheDocument();
    });

    it("renders catalog mode by default with schema table", async () => {
      renderProjectView(datasetRoute);
      expect(await screen.findByText("Field Name")).toBeInTheDocument();
      expect(screen.getByText("Type")).toBeInTheDocument();
    });

    it("toggles to table mode", async () => {
      renderProjectView(datasetRoute);
      await screen.findByLabelText("Catalog view");
      fireEvent.click(screen.getByLabelText("Table view"));
      expect(screen.queryByText("Field Name")).not.toBeInTheDocument();
    });

    it("shows dataset cards in horizontal row", async () => {
      renderProjectView(datasetRoute);
      await screen.findByLabelText("Catalog view");
      expect(screen.getByText("Inventory")).toBeInTheDocument();
      expect(screen.getByText("Returns")).toBeInTheDocument();
    });
  });
});
