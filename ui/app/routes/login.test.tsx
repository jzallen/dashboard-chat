// @vitest-environment happy-dom
//
// /login behaviors (CDO-S5; ADR-050 §d — mode discovery):
//   - on mount the route fetches the memoized fetchAuthConfig(); until it
//     resolves NO sign-in affordance renders (a neutral waiting surface — never a
//     flash of a dev button in workos mode);
//   - mode==='dev'    → the "Sign in (dev)" button;
//   - mode==='workos' → a plain "Sign in" button;
//   - BOTH onClick invoke the UNCHANGED login();
//   - hasSession() short-circuits to the workspace.
//
// Driven ports: the auth/bootstrap module seam (fetchAuthConfig + login) and the
// auth/tokenStorage seam (hasSession), vi.mocked as module boundaries.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAuthConfig, login } from "../auth/bootstrap";
import { hasSession } from "../auth/tokenStorage";
import LoginRoute from "./login";

vi.mock("../auth/tokenStorage", () => ({ hasSession: vi.fn() }));
vi.mock("../auth/bootstrap", () => ({
  fetchAuthConfig: vi.fn(),
  login: vi.fn(),
}));

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

describe("LoginRoute mode discovery (ADR-050 §d)", () => {
  it("renders NO sign-in affordance until fetchAuthConfig resolves", async () => {
    vi.mocked(hasSession).mockReturnValue(false);
    // A never-resolving config — the waiting window.
    vi.mocked(fetchAuthConfig).mockReturnValue(new Promise<never>(() => {}));

    renderLogin();

    // No button of any sign-in flavour while the mode is unknown.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/sign in/i)).toBeNull();
  });

  it("mode=dev: renders only the 'Sign in (dev)' button, which calls login()", async () => {
    vi.mocked(hasSession).mockReturnValue(false);
    vi.mocked(fetchAuthConfig).mockResolvedValue({ mode: "dev" });
    vi.mocked(login).mockResolvedValue(undefined);

    renderLogin();

    const button = await screen.findByText("Sign in (dev)");
    expect(button).toBeTruthy();
    fireEvent.click(button);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("mode=workos: renders a plain 'Sign in' button (no dev label), which calls login()", async () => {
    vi.mocked(hasSession).mockReturnValue(false);
    vi.mocked(fetchAuthConfig).mockResolvedValue({ mode: "workos" });
    vi.mocked(login).mockResolvedValue(undefined);

    renderLogin();

    const button = await screen.findByRole("button", { name: /^sign in$/i });
    expect(button).toBeTruthy();
    // No dev affordance leaked.
    expect(screen.queryByText("Sign in (dev)")).toBeNull();
    fireEvent.click(button);
    expect(login).toHaveBeenCalledTimes(1);
  });

  it("does NOT flash a dev button in workos mode (no affordance before the config resolves)", async () => {
    vi.mocked(hasSession).mockReturnValue(false);
    let resolveConfig!: (c: { mode: "dev" | "workos" }) => void;
    vi.mocked(fetchAuthConfig).mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }),
    );

    renderLogin();

    // Pre-resolution: nothing.
    expect(screen.queryByText("Sign in (dev)")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();

    resolveConfig({ mode: "workos" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy(),
    );
    // Never a dev button.
    expect(screen.queryByText("Sign in (dev)")).toBeNull();
  });

  it("redirects an already-signed-in person to the workspace via hasSession()", () => {
    vi.mocked(hasSession).mockReturnValue(true);
    renderLogin();
    expect(screen.getByText("WORKSPACE")).toBeTruthy();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(hasSession).toHaveBeenCalled();
  });
});
