// Acceptance scenarios for the `/` index swap → Pipeline landing (MR-4).
//
// Authored RED by DISTILL (path-forward.md §4.2). MR-4 swaps the index from chat to
// the Pipeline landing. Because Pipeline is project-scoped, the index resolves the
// org's default project off the AppShell outlet context and redirects to
// `projects/:projectId/pipeline`. Zero projects → `/projects` (never strand); still
// loading (null) → a resolving placeholder. The standalone deep-link routes are
// asserted intact via the destinations the redirect lands on.
import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub, Outlet, useParams } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import HomeRedirect from "./home";

// The outlet context the AppShell provides; mutated per test to drive each branch.
const ctx: { projects: Array<{ id: string; name: string }> | null } = {
  projects: null,
};

afterEach(() => {
  cleanup();
  ctx.projects = null;
});

function PipelineDest() {
  const { projectId } = useParams();
  return <div data-testid="dest-pipeline">{projectId}</div>;
}

function renderHome() {
  const Stub = createRoutesStub([
    {
      path: "/",
      // Stand-in for the AppShell layout — supplies the outlet context the index reads.
      Component: () => <Outlet context={{ projects: ctx.projects }} />,
      children: [
        { index: true, Component: HomeRedirect },
        { path: "projects/:projectId/pipeline", Component: PipelineDest },
        { path: "projects", Component: () => <div data-testid="dest-projects" /> },
      ],
    },
  ]);
  return render(<Stub initialEntries={["/"]} />);
}

describe("Home index — swaps `/` to the Pipeline landing", () => {
  it("redirects to the default project's pipeline when the org has projects", async () => {
    ctx.projects = [
      { id: "p1", name: "Alpha" },
      { id: "p2", name: "Beta" },
    ];
    renderHome();

    const dest = await screen.findByTestId("dest-pipeline");
    // The FIRST project is the default landing target.
    expect(dest).toHaveTextContent("p1");
  });

  it("redirects to the projects list when the org has no projects (never strands)", async () => {
    ctx.projects = [];
    renderHome();

    expect(await screen.findByTestId("dest-projects")).toBeInTheDocument();
    expect(screen.queryByTestId("dest-pipeline")).toBeNull();
  });

  it("shows a resolving placeholder while the project list is still loading", async () => {
    ctx.projects = null;
    renderHome();

    expect(await screen.findByTestId("home-resolving")).toBeInTheDocument();
    expect(screen.queryByTestId("dest-pipeline")).toBeNull();
  });
});
