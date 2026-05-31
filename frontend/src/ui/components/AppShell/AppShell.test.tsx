// Acceptance scenarios for the AppShell breadcrumb swap (MR-3).
//
// Authored RED by DISTILL (path-forward.md §4.1). MR-3 replaces the SideNav /
// UnifiedNav with the floating Breadcrumb over the centered content, and renders
// the Org Settings sheet when the breadcrumb toggles the `?org=1` search param.
// This locks the swap: the shell renders the Breadcrumb (never the old unified
// nav), always renders the route Outlet, and shows the org sheet iff `?org=1`.
//
// The Breadcrumb + OrgSheet are stubbed (their own behavior is covered by
// Breadcrumb.test / OrgSheet.test); providers, guards, and data hooks are doubled
// at their boundaries so the shell renders without network / EventSource.
import { cleanup, render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./index";

vi.mock("@/stream/StreamProvider", () => ({
  StreamProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../context/ChatContext", () => ({
  ChatProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useChatContext: () => ({ registerProjectId: vi.fn(), resetSession: vi.fn() }),
}));
vi.mock("./guards", () => ({
  RequireAuth: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  RequireOrg: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("../../hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({ data: { id: "org-1", name: "Acme" } }),
  useOrgProjectsQuery: () => ({ data: [{ id: "p1", name: "Alpha" }] }),
}));
vi.mock("../../hooks/useProjectQuery", () => ({
  useProjectQuery: () => ({ data: null }),
}));
vi.mock("../Breadcrumb", () => ({
  Breadcrumb: () => <nav data-testid="breadcrumb" />,
}));
vi.mock("../OrgView/OrgSheet", () => ({
  OrgSheet: () => <div data-testid="org-sheet" />,
}));
// MR-4: the assistant FAB/overlay mounts at shell level as a sibling of the Outlet
// (path-forward §4.4). Its own behavior is covered by Assistant.test; here we only
// assert the shell mounts it.
vi.mock("../Assistant", () => ({
  Assistant: () => <div data-testid="assistant" />,
}));

afterEach(() => cleanup());

function renderShellAt(path: string) {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: AppShell,
      children: [
        { index: true, Component: () => <div data-testid="outlet" /> },
      ],
    },
  ]);
  return render(<Stub initialEntries={[path]} />);
}

describe("AppShell — breadcrumb shell replaces the SideNav", () => {
  it("renders the breadcrumb and the route outlet, not the old unified nav", async () => {
    renderShellAt("/");

    expect(await screen.findByTestId("breadcrumb")).toBeInTheDocument();
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
    expect(screen.queryByTestId("unified-nav")).toBeNull();
  });

  it("does not render the org sheet without the ?org=1 param", async () => {
    renderShellAt("/");

    await screen.findByTestId("breadcrumb");
    expect(screen.queryByTestId("org-sheet")).toBeNull();
  });

  it("renders the org sheet when the ?org=1 param is present", async () => {
    renderShellAt("/?org=1");

    expect(await screen.findByTestId("org-sheet")).toBeInTheDocument();
  });

  it("mounts the shell-level Assistant as a sibling of the outlet (MR-4)", async () => {
    renderShellAt("/");

    expect(await screen.findByTestId("assistant")).toBeInTheDocument();
    // It floats over the routed content, not inside it.
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });
});
