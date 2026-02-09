import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProjectNav } from "../../../lib/ui/components/ProjectNav";
import { MOCK_PROJECT } from "../../../__mocks__/data";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

function renderNav(props: Partial<Parameters<typeof ProjectNav>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ProjectNav
        project={MOCK_PROJECT}
        activeDatasetId={null}
        collapsed={false}
        onToggleCollapse={vi.fn()}
        {...props}
      />
    </MemoryRouter>
  );
}

describe("ProjectNav", () => {
  beforeEach(() => mockNavigate.mockClear());

  it("renders project name and dataset list", () => {
    renderNav();
    expect(screen.getByText("Inventory Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sales Data")).toBeInTheDocument();
    expect(screen.getByText("Inventory")).toBeInTheDocument();
    expect(screen.getByText("Returns")).toBeInTheDocument();
  });

  it("highlights active dataset", () => {
    renderNav({ activeDatasetId: "ds-002" });
    const activeButton = screen.getByText("Inventory").closest("button");
    expect(activeButton?.className).toContain("navItemActive");
  });

  it("navigates on dataset click", () => {
    renderNav();
    fireEvent.click(screen.getByText("Sales Data"));
    expect(mockNavigate).toHaveBeenCalledWith("/projects/proj-001/datasets/ds-001");
  });

  it("collapses on toggle click", () => {
    const onToggle = vi.fn();
    renderNav({ onToggleCollapse: onToggle });
    fireEvent.click(screen.getByLabelText("Collapse navigation"));
    expect(onToggle).toHaveBeenCalled();
  });

  it("shows skeleton when project is null", () => {
    renderNav({ project: null });
    expect(screen.queryByText("Sales Data")).not.toBeInTheDocument();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("hides labels when collapsed", () => {
    renderNav({ collapsed: true });
    expect(screen.queryByText("Sales Data")).not.toBeInTheDocument();
    expect(screen.queryByText("Inventory Dashboard")).not.toBeInTheDocument();
  });
});
