import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, Outlet } from "react-router-dom";
import { ProjectView } from "../../../lib/ui/components/DatasetView";
import { ChatProvider } from "../../../lib/ui/context/ChatContext";
import { MOCK_PROJECT } from "../../../__mocks__/data";

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

/** Layout route that injects outlet context like AppShell does */
function ContextLayout() {
  return <Outlet context={{ project: MOCK_PROJECT }} />;
}

function renderProjectView(route = "/") {
  return render(
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
      await screen.findByLabelText("Catalog view");
      expect(screen.getByText("Field Name")).toBeInTheDocument();
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
