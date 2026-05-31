import { fireEvent, render, screen } from "@testing-library/react";
import { createRoutesStub, MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { DependencyStrip, type DependencyNode } from "./DependencyStrip";

// MR-5 — DependencyStrip: upstream/downstream links to model detail routes.
const upstream: DependencyNode[] = [
  { id: "ds-1", name: "Orders", kind: "dataset" },
];
const downstream: DependencyNode[] = [
  { id: "view-9", name: "Order View", kind: "view" },
  { id: "report-9", name: "Revenue", kind: "report" },
];

function renderStrip(props: Parameters<typeof DependencyStrip>[0]) {
  return render(
    <MemoryRouter>
      <DependencyStrip {...props} />
    </MemoryRouter>,
  );
}

describe("DependencyStrip", () => {
  it("renders the strip with upstream and downstream groups", () => {
    renderStrip({ upstream, downstream });
    expect(screen.getByTestId("dependency-strip")).toBeInTheDocument();
    expect(screen.getByTestId("dependency-upstream")).toBeInTheDocument();
    expect(screen.getByTestId("dependency-downstream")).toBeInTheDocument();
  });

  it("links each dependency to its detail route by kind", () => {
    renderStrip({ upstream, downstream });
    expect(screen.getByTestId("dep-link-ds-1")).toHaveAttribute("href", "/table/ds-1");
    expect(screen.getByTestId("dep-link-view-9")).toHaveAttribute("href", "/view/view-9");
    expect(screen.getByTestId("dep-link-report-9")).toHaveAttribute("href", "/report/report-9");
  });

  it("shows the dependency node names", () => {
    renderStrip({ upstream, downstream });
    expect(screen.getByText("Orders")).toBeInTheDocument();
    expect(screen.getByText("Revenue")).toBeInTheDocument();
  });

  it("renders an empty-state when there are no dependencies", () => {
    renderStrip({ upstream: [], downstream: [] });
    expect(screen.getByTestId("dependency-strip-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("dependency-upstream")).not.toBeInTheDocument();
  });

  it("renders a loading state while dependencies resolve", () => {
    renderStrip({ upstream: [], downstream: [], isLoading: true });
    expect(screen.getByTestId("dependency-strip-loading")).toBeInTheDocument();
  });

  // @walking_skeleton — the load-bearing MR-5 thin slice: a real dependency link
  // navigates to the linked model's detail route (port-to-port via createRoutesStub).
  it("@walking_skeleton navigates to a linked model's detail route on click", async () => {
    const Stub = createRoutesStub([
      {
        path: "/view/:viewId",
        Component: () => (
          <DependencyStrip
            upstream={[]}
            downstream={[{ id: "report-9", name: "Revenue", kind: "report" }]}
          />
        ),
      },
      {
        path: "/report/:reportId",
        Component: () => <div data-testid="report-destination">report detail</div>,
      },
    ]);
    render(<Stub initialEntries={["/view/view-1"]} />);
    fireEvent.click(screen.getByTestId("dep-link-report-9"));
    expect(await screen.findByTestId("report-destination")).toBeInTheDocument();
  });
});
