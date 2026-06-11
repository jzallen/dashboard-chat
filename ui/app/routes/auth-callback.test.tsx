// @vitest-environment happy-dom
//
// /auth/callback behaviors:
//   - dev: ?code=dev-auth-code (no state) → handleCallback(code, undefined);
//   - workos: ?code=…&state=… → handleCallback(code, state) so the auth-proxy's
//     CSRF round-trip check passes (the bug that produced 400 state_mismatch);
//   - on success → replace-navigate to the workspace; on failure → back to /login;
//   - a missing code short-circuits to /login without calling handleCallback.
//
// Driven port: the auth/bootstrap module seam (handleCallback), vi.mocked.
import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleCallback } from "../auth/bootstrap";
import AuthCallbackRoute from "./auth-callback";

vi.mock("../auth/bootstrap", () => ({ handleCallback: vi.fn() }));

afterEach(() => vi.clearAllMocks());

function renderCallback(initialEntry: string) {
  const router = createMemoryRouter(
    [
      { path: "/auth/callback", element: <AuthCallbackRoute /> },
      { path: "/", element: <div>WORKSPACE</div> },
      { path: "/login", element: <div>LOGIN</div> },
    ],
    { initialEntries: [initialEntry] },
  );
  return render(<RouterProvider router={router} />);
}

describe("AuthCallbackRoute", () => {
  it("workos: forwards BOTH the code and the echoed state to handleCallback", async () => {
    vi.mocked(handleCallback).mockResolvedValue(undefined);

    renderCallback("/auth/callback?code=wc&state=S9");

    await waitFor(() =>
      expect(handleCallback).toHaveBeenCalledWith("wc", "S9"),
    );
    await waitFor(() => expect(screen.getByText("WORKSPACE")).toBeTruthy());
  });

  it("dev: forwards the code with an undefined state", async () => {
    vi.mocked(handleCallback).mockResolvedValue(undefined);

    renderCallback("/auth/callback?code=dev-auth-code");

    await waitFor(() =>
      expect(handleCallback).toHaveBeenCalledWith("dev-auth-code", undefined),
    );
  });

  it("routes back to /login when handleCallback rejects", async () => {
    vi.mocked(handleCallback).mockRejectedValue(new Error("callback failed"));

    renderCallback("/auth/callback?code=wc&state=S9");

    await waitFor(() => expect(screen.getByText("LOGIN")).toBeTruthy());
  });

  it("short-circuits to /login without calling handleCallback when no code", async () => {
    renderCallback("/auth/callback");

    await waitFor(() => expect(screen.getByText("LOGIN")).toBeTruthy());
    expect(handleCallback).not.toHaveBeenCalled();
  });
});
