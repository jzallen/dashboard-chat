import { fireEvent,render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { MOCK_DATASETS, MOCK_PROJECT } from "../../../__mocks__/data";
import { createMockProject } from "../../../__mocks__/data";
import { SideNav } from "../../../ui/components/SideNav";
import { OrgNav } from "../../../ui/components/SideNav/OrgNav";
import { ProjectNav } from "../../../ui/components/SideNav/ProjectNav";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const MOCK_PROJECTS = [
  MOCK_PROJECT,
  createMockProject({ id: "proj-002", name: "Analytics", datasets: [] }),
];

function renderOrgNav(overrides: { collapsed?: boolean; onToggleCollapse?: () => void } = {}) {
  return render(
    <MemoryRouter>
      <SideNav
        orgName="Test Org"
        collapsed={overrides.collapsed ?? false}
        onToggleCollapse={overrides.onToggleCollapse ?? vi.fn()}
      >
        <OrgNav
          projects={MOCK_PROJECTS}
          activeProjectId={null}
          collapsed={overrides.collapsed ?? false}
          onSelectProject={(id) => mockNavigate(`/projects/${id}`)}
        />
      </SideNav>
    </MemoryRouter>
  );
}

function renderProjectNav(overrides: { collapsed?: boolean; onToggleCollapse?: () => void; activeDatasetId?: string | null } = {}) {
  return render(
    <MemoryRouter>
      <SideNav
        orgName="Test Org"
        collapsed={overrides.collapsed ?? false}
        onToggleCollapse={overrides.onToggleCollapse ?? vi.fn()}
      >
        <ProjectNav
          project={MOCK_PROJECT}
          datasets={MOCK_DATASETS}
          activeDatasetId={overrides.activeDatasetId ?? null}
          collapsed={overrides.collapsed ?? false}
          onSelectProject={() => mockNavigate(`/projects/${MOCK_PROJECT.id}`)}
          onSelectDataset={(dsId) => mockNavigate(`/projects/${MOCK_PROJECT.id}/datasets/${dsId}`)}
        />
      </SideNav>
    </MemoryRouter>
  );
}

describe("SideNav", () => {
  beforeEach(() => mockNavigate.mockClear());

  describe("org mode", () => {
    it("renders org name and project list", () => {
      renderOrgNav();
      expect(screen.getByText("Test Org")).toBeInTheDocument();
      expect(screen.getByText("Inventory Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Analytics")).toBeInTheDocument();
    });

    it("navigates on project click", () => {
      renderOrgNav();
      fireEvent.click(screen.getByText("Inventory Dashboard"));
      expect(mockNavigate).toHaveBeenCalledWith("/projects/proj-001");
    });

    it("collapses on toggle click", () => {
      const onToggle = vi.fn();
      renderOrgNav({ onToggleCollapse: onToggle });
      fireEvent.click(screen.getByLabelText("Collapse navigation"));
      expect(onToggle).toHaveBeenCalled();
    });

    it("hides labels when collapsed", () => {
      renderOrgNav({ collapsed: true });
      expect(screen.queryByText("Inventory Dashboard")).not.toBeInTheDocument();
      expect(screen.queryByText("Test Org")).not.toBeInTheDocument();
    });
  });

  describe("project mode", () => {
    it("renders org name and project heading with datasets", () => {
      renderProjectNav();
      expect(screen.getByText("Test Org")).toBeInTheDocument();
      expect(screen.getByText("Inventory Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Sales Data")).toBeInTheDocument();
      expect(screen.getByText("Inventory")).toBeInTheDocument();
      expect(screen.getByText("Returns")).toBeInTheDocument();
    });

    it("highlights active dataset", () => {
      renderProjectNav({ activeDatasetId: "ds-002" });
      const activeButton = screen.getByText("Inventory").closest("button");
      expect(activeButton?.className).toContain("navItemActive");
    });

    it("navigates on dataset click", () => {
      renderProjectNav();
      fireEvent.click(screen.getByText("Sales Data"));
      expect(mockNavigate).toHaveBeenCalledWith("/projects/proj-001/datasets/ds-001");
    });

    it("navigates to project on project heading click", () => {
      renderProjectNav();
      fireEvent.click(screen.getByText("Inventory Dashboard"));
      expect(mockNavigate).toHaveBeenCalledWith("/projects/proj-001");
    });

    it("hides labels when collapsed", () => {
      renderProjectNav({ collapsed: true });
      expect(screen.queryByText("Sales Data")).not.toBeInTheDocument();
      expect(screen.queryByText("Test Org")).not.toBeInTheDocument();
    });
  });
});
