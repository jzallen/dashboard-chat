// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { hasSession } from "../auth/tokenStorage";
import LoginRoute from "./login";

vi.mock("../auth/tokenStorage", () => ({ hasSession: vi.fn() }));
vi.mock("../auth/bootstrap", () => ({ login: vi.fn() }));

afterEach(() => vi.clearAllMocks());

function renderLogin() {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginRoute /> },
      { path: "/", element: <div>WORKSPACE</div> },
    ],
    { initialEntries: ["/login"] },
  );
  return render(<RouterProvider router={router} />);
}

describe("LoginRoute gate (flag cookie, not the unreadable token)", () => {
  it("shows the dev sign-in button when there is no session", () => {
    vi.mocked(hasSession).mockReturnValue(false);
    renderLogin();
    expect(screen.getByText("Sign in (dev)")).toBeTruthy();
  });

  it("redirects an already-signed-in person to the workspace via hasSession()", () => {
    vi.mocked(hasSession).mockReturnValue(true);
    renderLogin();
    expect(screen.getByText("WORKSPACE")).toBeTruthy();
    expect(screen.queryByText("Sign in (dev)")).toBeNull();
    expect(hasSession).toHaveBeenCalled();
  });
});
