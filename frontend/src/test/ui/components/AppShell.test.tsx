import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../../../lib/ui/components/AppShell";

// Mock API calls
vi.mock("@/api", async () => {
  const actual = await vi.importActual<typeof import("@/api")>("@/api");
  const { MOCK_PROJECT } = await import("../../../__mocks__/data");
  return {
    ...actual,
    getProject: vi.fn().mockResolvedValue(MOCK_PROJECT),
    getDataset: vi.fn().mockResolvedValue(null),
  };
});

function renderShell(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>project-grid-content</div>} />
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
  it("renders three panels: nav, view window, and chat", async () => {
    renderShell();
    // Nav: project name loads
    expect(await screen.findByText("Inventory Dashboard")).toBeInTheDocument();
    // View: outlet content renders
    expect(screen.getByText("project-grid-content")).toBeInTheDocument();
    // Chat: header visible
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("renders outlet content for dataset route", async () => {
    renderShell("/projects/proj-001/datasets/ds-001");
    expect(await screen.findByText("dataset-view-content")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
  });

  it("shows project nav with datasets", async () => {
    renderShell();
    expect(await screen.findByText("Sales Data")).toBeInTheDocument();
    expect(screen.getByText("Inventory")).toBeInTheDocument();
    expect(screen.getByText("Returns")).toBeInTheDocument();
  });
});
