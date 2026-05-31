// Acceptance scenarios for the Org Settings sheet (MR-3).
//
// Authored RED by DISTILL (path-forward.md §4.1 / §4.2). AppShell renders the sheet
// when the breadcrumb toggles `?org=1`. The sheet hosts the existing org surface —
// the MR-1 Appearance / dark-mode ThemeToggle plus the project grid — over a darker
// inset backdrop. Clicking the backdrop or the close control clears the param
// (onClose); selecting a project navigates to its MR-2 Pipeline landing and closes.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OrgSheet } from "./OrgSheet";

const projects = [
  {
    id: "p1",
    name: "Alpha",
    description: null,
    created_at: "",
    updated_at: "",
  },
];

afterEach(() => cleanup());

function renderSheet(onClose: () => void) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: () => (
        <OrgSheet projects={projects} orgName="Acme" onClose={onClose} />
      ),
    },
    {
      path: "projects/:projectId/pipeline",
      Component: () => <div data-testid="dest-pipeline" />,
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("OrgSheet — org settings overlay", () => {
  it("renders the sheet with the Appearance dark-mode toggle and the project grid", async () => {
    renderSheet(vi.fn());

    expect(await screen.findByTestId("org-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("dark-mode-toggle")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("calls onClose when the darker inset backdrop is clicked", async () => {
    const onClose = vi.fn();
    renderSheet(onClose);

    fireEvent.click(await screen.findByTestId("org-sheet-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the close control is clicked", async () => {
    const onClose = vi.fn();
    renderSheet(onClose);

    fireEvent.click(await screen.findByTestId("org-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("navigates to the project's pipeline landing and closes the sheet on project select", async () => {
    const onClose = vi.fn();
    renderSheet(onClose);

    fireEvent.click(await screen.findByText("Alpha"));

    expect(await screen.findByTestId("dest-pipeline")).toBeInTheDocument();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
