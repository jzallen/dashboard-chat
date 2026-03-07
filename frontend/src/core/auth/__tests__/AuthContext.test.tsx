// Force dev auth mode: Vite statically replaces import.meta.env.VITE_AUTH_MODE at transform time,
// so we must set it in process.env before the module is transformed.
vi.hoisted(() => {
  process.env.VITE_AUTH_MODE = "dev";
});

import { act, render, screen } from "@testing-library/react";

import { AuthProvider, useAuth } from "../../../ui/context/AuthContext";

// Mock the shared config (AuthProvider uses ApiClient directly now)
vi.mock("../../../lib/http/config", () => ({
  DATA_CATALOG_BASE_URL: "",
}));

function TestConsumer() {
  const { isAuthenticated, isLoading, user, token, logout } = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(isLoading)}</span>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="user">{user ? user.email : "null"}</span>
      <span data-testid="token">{token ?? "null"}</span>
      <button data-testid="logout" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

describe("AuthContext", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("auto-authenticates in dev mode with dev user", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    // Dev mode (default in tests) auto-sets authenticated state
    expect(
      await screen.findByText("true", {
        selector: '[data-testid="authenticated"]',
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("user").textContent).toBe("dev@localhost");
    expect(screen.getByTestId("token").textContent).toBe("dev-token-static");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });

  it("sets token and user in localStorage in dev mode", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await screen.findByText("true", {
      selector: '[data-testid="authenticated"]',
    });
    expect(localStorage.getItem("auth_token")).toBe("dev-token-static");
    expect(JSON.parse(localStorage.getItem("auth_user")!)).toEqual(
      expect.objectContaining({
        email: "dev@localhost",
        org_id: "dev-org-001",
      }),
    );
  });

  it("renders children", () => {
    render(
      <AuthProvider>
        <div>child content</div>
      </AuthProvider>,
    );
    expect(screen.getByText("child content")).toBeInTheDocument();
  });

  it("logout clears state and localStorage", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await screen.findByText("true", {
      selector: '[data-testid="authenticated"]',
    });

    act(() => {
      screen.getByTestId("logout").click();
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("false");
    expect(screen.getByTestId("user").textContent).toBe("null");
    expect(screen.getByTestId("token").textContent).toBe("null");
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_user")).toBeNull();
  });

  it("useAuth throws when used outside AuthProvider", () => {
    function Orphan() {
      useAuth();
      return null;
    }

    // Suppress console.error from React's error boundary
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(
      "useAuth must be used within AuthProvider",
    );
    spy.mockRestore();
  });
});
