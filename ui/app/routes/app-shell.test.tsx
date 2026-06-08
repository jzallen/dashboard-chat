// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasSession } from "../auth/tokenStorage";
import { refreshOrgGlobal } from "../components/useCatalog";
import AppShell, { clientLoader } from "./app-shell";

vi.mock("../auth/tokenStorage", () => ({ hasSession: vi.fn() }));
vi.mock("../components/useCatalog", () => ({
  refreshOrgGlobal: vi.fn(async () => {}),
  useCatalog: vi.fn(() => 0),
  catalog: { listModels: () => [] },
}));

afterEach(() => vi.clearAllMocks());

describe("app-shell clientLoader — org-global fetch gated on the session", () => {
  it("fetches org-global data when hasSession() is true", async () => {
    vi.mocked(hasSession).mockReturnValue(true);
    await clientLoader();
    expect(refreshOrgGlobal).toHaveBeenCalledTimes(1);
  });

  it("does NOT fetch when hasSession() is false (no 401s on the login round-trip)", async () => {
    vi.mocked(hasSession).mockReturnValue(false);
    await clientLoader();
    expect(refreshOrgGlobal).not.toHaveBeenCalled();
  });
});

describe("AppShell gate", () => {
  it("redirects to /login when there is no session", () => {
    vi.mocked(hasSession).mockReturnValue(false);
    const router = createMemoryRouter(
      [
        { path: "/", element: <AppShell /> },
        { path: "/login", element: <div>LOGIN</div> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    expect(screen.getByText("LOGIN")).toBeTruthy();
    expect(hasSession).toHaveBeenCalled();
  });
});
