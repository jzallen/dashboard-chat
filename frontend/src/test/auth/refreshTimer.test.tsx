// Set auth mode to "workos" so dev auto-auth doesn't fire
vi.hoisted(() => {
  process.env.VITE_AUTH_MODE = "workos";
});

import { render, screen, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../lib/auth";

// Mock the API client used by login/handleCallback
vi.mock("../../lib/api/client", () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function TestConsumer() {
  const { isAuthenticated, token, logout } = useAuth();
  return (
    <div>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="token">{token ?? "null"}</span>
      <button data-testid="logout" onClick={logout}>Logout</button>
    </div>
  );
}

function makeRefreshResponse(accessToken: string, refreshToken: string, expiresIn: number) {
  return new Response(
    JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("Proactive refresh timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules refresh at 80% of TTL", async () => {
    // Pre-seed localStorage with an authenticated session (60s TTL)
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem("auth_token", "old-access");
    localStorage.setItem("auth_user", JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }));
    localStorage.setItem("auth_refresh_token", "old-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    mockFetch.mockResolvedValueOnce(makeRefreshResponse("new-access", "new-refresh", 60));

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("true");
    expect(screen.getByTestId("token").textContent).toBe("old-access");

    // No fetch yet — timer hasn't fired
    expect(mockFetch).not.toHaveBeenCalled();

    // Advance to 80% of 60s = 48s
    await act(async () => {
      vi.advanceTimersByTime(48_000);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/refresh"),
      expect.objectContaining({ method: "POST" }),
    );

    // After successful refresh, token should be updated
    expect(screen.getByTestId("token").textContent).toBe("new-access");
    expect(localStorage.getItem("auth_token")).toBe("new-access");
    expect(localStorage.getItem("auth_refresh_token")).toBe("new-refresh");
  });

  it("retries once after 5s on failure, then succeeds", async () => {
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem("auth_token", "old-access");
    localStorage.setItem("auth_user", JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }));
    localStorage.setItem("auth_refresh_token", "old-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    // First call fails, second succeeds
    mockFetch
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))
      .mockResolvedValueOnce(makeRefreshResponse("retry-access", "retry-refresh", 60));

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );
    });

    // Trigger the timer (80% of 60s)
    await act(async () => {
      vi.advanceTimersByTime(48_000);
    });

    // First attempt failed
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Wait 5s for the retry
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("token").textContent).toBe("retry-access");
  });

  it("logs out after first attempt and retry both fail", async () => {
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem("auth_token", "old-access");
    localStorage.setItem("auth_user", JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }));
    localStorage.setItem("auth_refresh_token", "old-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    mockFetch
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))
      .mockResolvedValueOnce(new Response("fail", { status: 500 }));

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("true");

    // Trigger the timer
    await act(async () => {
      vi.advanceTimersByTime(48_000);
    });

    // Wait for retry
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    // Both attempts failed => logout
    expect(screen.getByTestId("authenticated").textContent).toBe("false");
    expect(localStorage.getItem("auth_token")).toBeNull();
    expect(localStorage.getItem("auth_refresh_token")).toBeNull();
  });

  it("does not schedule timer when not authenticated", async () => {
    // No pre-seeded data — user is not authenticated
    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("false");

    // Advance time — nothing should happen
    await act(async () => {
      vi.advanceTimersByTime(100_000);
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
