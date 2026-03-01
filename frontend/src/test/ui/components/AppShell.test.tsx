import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "../../../lib/ui/components/AppShell";

// Mock API calls
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  const { MOCK_DATASETS, MOCK_PROJECT } = await import("../../../__mocks__/data");
  return {
    ...actual,
    get: vi.fn().mockImplementation((url: string) => {
      if (url === "/api/orgs/me") return Promise.resolve({ id: "org-001", name: "Test Org" });
      return Promise.resolve(null);
    }),
    listProjects: vi.fn().mockResolvedValue([MOCK_PROJECT]),
    getProject: vi.fn().mockResolvedValue(MOCK_PROJECT),
    getDataset: vi.fn().mockResolvedValue(null),
    listDatasetsForProject: vi.fn().mockResolvedValue(MOCK_DATASETS),
  };
});

function renderShell(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>org-content</div>} />
          <Route path="/projects/:projectId" element={<div>project-grid-content</div>} />
          <Route
            path="/projects/:projectId/datasets/:datasetId"
            element={<div>dataset-view-content</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe("AppShell", () => {
  it("renders org-level layout with org name in nav", async () => {
    renderShell("/");
    expect(await screen.findByText("Test Org")).toBeInTheDocument();
    expect(screen.getByText("org-content")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("renders project-level layout with project nav", async () => {
    renderShell("/projects/proj-001");
    expect(await screen.findByText("Inventory Dashboard")).toBeInTheDocument();
    expect(screen.getByText("project-grid-content")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("renders outlet content for dataset route", async () => {
    renderShell("/projects/proj-001/datasets/ds-001");
    expect(await screen.findByText("dataset-view-content")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("shows project nav with datasets in project mode", async () => {
    renderShell("/projects/proj-001");
    expect(await screen.findByText("Sales Data")).toBeInTheDocument();
    expect(screen.getByText("Inventory")).toBeInTheDocument();
    expect(screen.getByText("Returns")).toBeInTheDocument();
  });

  it("shows project list in org mode sidebar", async () => {
    renderShell("/");
    expect(await screen.findByText("Inventory Dashboard")).toBeInTheDocument();
  });
});
