// @vitest-environment happy-dom
//
// /login behaviors (CDO-S5; ADR-050 §d — mode discovery):
//   - on mount the route fetches the memoized fetchAuthConfig(); until it
//     resolves NO affordance renders (a neutral waiting surface — never a flash
//     of a button in workos mode);
//   - mode==='dev'    → the "Sign in (dev)" button; onClick invokes login();
//   - mode==='workos' → NO button: WorkOS is the sign-in page, so the route
//     hands off via login() immediately (only a redirect notice renders);
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

  it("mode=workos: shows NO sign-in button and hands off to WorkOS via login()", async () => {
    vi.mocked(hasSession).mockReturnValue(false);
    vi.mocked(fetchAuthConfig).mockResolvedValue({ mode: "workos" });
    vi.mocked(login).mockResolvedValue(undefined);

    renderLogin();

    // login() is invoked automatically — WorkOS itself is the sign-in page.
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    // No local button of any flavour — neither dev nor a plain "Sign in".
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Sign in (dev)")).toBeNull();
    expect(screen.getByText(/redirecting to sign-in/i)).toBeTruthy();
  });

  it("does NOT flash any button before the config resolves, and never a dev button in workos", async () => {
    vi.mocked(hasSession).mockReturnValue(false);
    vi.mocked(login).mockResolvedValue(undefined);
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

    // Post-resolution: auto-redirect, still no button (and never a dev button).
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText("Sign in (dev)")).toBeNull();
  });

  it("mode=workos: surfaces a Retry affordance only when the handoff fails", async () => {
    vi.mocked(hasSession).mockReturnValue(false);
    vi.mocked(fetchAuthConfig).mockResolvedValue({ mode: "workos" });
    vi.mocked(login).mockRejectedValueOnce(new Error("login failed: 503"));

    renderLogin();

    const retry = await screen.findByRole("button", { name: /retry/i });
    expect(retry).toBeTruthy();
    vi.mocked(login).mockResolvedValue(undefined);
    fireEvent.click(retry);
    await waitFor(() => expect(login).toHaveBeenCalledTimes(2));
  });

  it("redirects an already-signed-in person to the workspace via hasSession()", () => {
    vi.mocked(hasSession).mockReturnValue(true);
    renderLogin();
    expect(screen.getByText("WORKSPACE")).toBeTruthy();
    expect(screen.queryByText(/sign in/i)).toBeNull();
    expect(hasSession).toHaveBeenCalled();
  });
});
