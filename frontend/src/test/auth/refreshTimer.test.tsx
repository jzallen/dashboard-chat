// Set auth mode to "workos" so dev auto-auth doesn't fire
vi.hoisted(() => {
  process.env.VITE_AUTH_MODE = "workos";
});

import { render, screen, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "../../lib/auth";
import { _resetRefreshState } from "../../lib/api/fetchUtils";

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
    _resetRefreshState();
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

  it("retries once after 12s on failure, then succeeds", async () => {
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

    // Wait 12s for the retry (matches backend rate limiter window)
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("token").textContent).toBe("retry-access");
  });

  it("schedules a 30-second retry when proactive refresh fails", async () => {
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem("auth_token", "old-access");
    localStorage.setItem("auth_user", JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }));
    localStorage.setItem("auth_refresh_token", "old-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    // First two calls fail (ensureFreshToken initial + internal retry),
    // then after 30s AuthContext retry, two more succeed
    mockFetch
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))
      .mockResolvedValueOnce(makeRefreshResponse("recovered-access", "recovered-refresh", 60));

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );
    });

    // Trigger the timer (80% of 60s = 48s)
    await act(async () => {
      vi.advanceTimersByTime(48_000);
    });

    // First fetch fired
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Wait 12s for ensureFreshToken internal retry
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });

    // Internal retry also failed
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // User should still be authenticated (no logout on first failure)
    expect(screen.getByTestId("authenticated").textContent).toBe("true");

    // Wait 500ms for coalescing window to clear, then 30s for AuthContext retry
    await act(async () => {
      vi.advanceTimersByTime(500 + 30_000);
    });

    // AuthContext 30s retry calls ensureFreshToken again — this time it succeeds
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("token").textContent).toBe("recovered-access");
    expect(localStorage.getItem("auth_token")).toBe("recovered-access");
  });

  it("remains authenticated after all refresh retries are exhausted", async () => {
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem("auth_token", "old-access");
    localStorage.setItem("auth_user", JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }));
    localStorage.setItem("auth_refresh_token", "old-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    // 6 total failures: 3 AuthContext attempts x 2 ensureFreshToken fetches each
    mockFetch
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))  // attempt 1, fetch 1
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))  // attempt 1, fetch 2 (12s internal retry)
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))  // attempt 2, fetch 1 (30s AuthContext retry)
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))  // attempt 2, fetch 2 (12s internal retry)
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))  // attempt 3, fetch 1 (60s AuthContext retry)
      .mockResolvedValueOnce(new Response("fail", { status: 500 })); // attempt 3, fetch 2 (12s internal retry)

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("true");

    // Attempt 1: timer fires at 48s
    await act(async () => {
      vi.advanceTimersByTime(48_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // ensureFreshToken internal retry after 12s
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Attempt 2: AuthContext retries after 30s (+ 500ms coalescing window)
    await act(async () => {
      vi.advanceTimersByTime(500 + 30_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // ensureFreshToken internal retry after 12s
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(4);

    // Attempt 3: AuthContext retries after 60s (+ 500ms coalescing window)
    await act(async () => {
      vi.advanceTimersByTime(500 + 60_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(5);

    // ensureFreshToken internal retry after 12s
    await act(async () => {
      vi.advanceTimersByTime(12_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(6);

    // All retries exhausted — user should STILL be authenticated (no logout)
    expect(screen.getByTestId("authenticated").textContent).toBe("true");
    // Token stays in localStorage (not cleared)
    expect(localStorage.getItem("auth_token")).toBe("old-access");
  });

  it("skips refresh if token is still fresh (freshness guard)", async () => {
    // Use 600s TTL so that at 80% (480s), remaining = 120s > 60s → freshness guard skips
    const expiresAt = Date.now() + 600_000;
    localStorage.setItem("auth_token", "fresh-access");
    localStorage.setItem("auth_user", JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }));
    localStorage.setItem("auth_refresh_token", "some-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    await act(async () => {
      render(
        <AuthProvider>
          <TestConsumer />
        </AuthProvider>,
      );
    });

    expect(screen.getByTestId("authenticated").textContent).toBe("true");

    // Advance to 80% of 600s = 480s
    await act(async () => {
      vi.advanceTimersByTime(480_000);
    });

    // Timer fired, ensureFreshToken was called but the freshness guard
    // detected remaining TTL (120s) > 60s and returned current token without fetching
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByTestId("token").textContent).toBe("fresh-access");
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
