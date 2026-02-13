import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SideNav } from "../../../lib/ui/components/SideNav";
import { MOCK_PROJECT } from "../../../__mocks__/data";
import { createMockProject } from "../../../__mocks__/data";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

const MOCK_PROJECTS = [
  MOCK_PROJECT,
  createMockProject({ id: "proj-002", name: "Analytics", datasets: [] }),
];

function renderOrgNav(overrides: Partial<Parameters<typeof SideNav>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SideNav
        mode="org"
        orgName="Test Org"
        projects={MOCK_PROJECTS}
        activeProjectId={null}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>
  );
}

function renderProjectNav(overrides: Partial<Parameters<typeof SideNav>[0]> = {}) {
  return render(
    <MemoryRouter>
      <SideNav
        mode="project"
        orgName="Test Org"
        project={MOCK_PROJECT}
        activeDatasetId={null}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        {...overrides}
      />
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
      renderProjectNav({ activeDatasetId: "ds-002" } as any);
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
      renderProjectNav({ collapsed: true } as any);
      expect(screen.queryByText("Sales Data")).not.toBeInTheDocument();
      expect(screen.queryByText("Test Org")).not.toBeInTheDocument();
    });
  });
});
