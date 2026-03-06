// Set auth mode to "workos" so dev auto-auth doesn't fire
vi.hoisted(() => {
  process.env.VITE_AUTH_MODE = "workos";
});

import { act, render, screen } from "@testing-library/react";

import { AuthProvider, useAuth } from "../../../ui/context/AuthContext";

// Mock the shared config (AuthProvider uses ApiClient directly now)
vi.mock("../../../lib/http/config", () => ({
  DATA_CATALOG_BASE_URL: "",
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function TestConsumer() {
  const { isAuthenticated, token, logout } = useAuth();
  return (
    <div>
      <span data-testid="authenticated">{String(isAuthenticated)}</span>
      <span data-testid="token">{token ?? "null"}</span>
      <button data-testid="logout" onClick={logout}>
        Logout
      </button>
    </div>
  );
}

function makeRefreshResponse(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
) {
  return new Response(
    JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
    }),
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
    localStorage.setItem(
      "auth_user",
      JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }),
    );
    localStorage.setItem("auth_refresh_token", "old-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    mockFetch.mockResolvedValueOnce(
      makeRefreshResponse("new-access", "new-refresh", 60),
    );

    // eslint-disable-next-line testing-library/no-unnecessary-act
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

  it("fails immediately on non-429 error (no internal retry)", async () => {
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem("auth_token", "old-access");
    localStorage.setItem(
      "auth_user",
      JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }),
    );
    localStorage.setItem("auth_refresh_token", "old-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    // 500 error — should fail immediately without retry
    mockFetch.mockResolvedValueOnce(new Response("fail", { status: 500 }));

    // eslint-disable-next-line testing-library/no-unnecessary-act
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

    // Only one attempt — no 12s retry for non-429 errors
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // User should still be authenticated (no logout on proactive failure)
    expect(screen.getByTestId("authenticated").textContent).toBe("true");
  });

  it("schedules a 30-second retry when proactive refresh fails", async () => {
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem("auth_token", "old-access");
    localStorage.setItem(
      "auth_user",
      JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }),
    );
    localStorage.setItem("auth_refresh_token", "old-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    // First call fails (non-429, no internal retry),
    // then after 30s AuthContext retry succeeds
    mockFetch
      .mockResolvedValueOnce(new Response("fail", { status: 500 }))
      .mockResolvedValueOnce(
        makeRefreshResponse("recovered-access", "recovered-refresh", 60),
      );

    // eslint-disable-next-line testing-library/no-unnecessary-act
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

    // First fetch fired and failed immediately (no internal retry)
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // User should still be authenticated (no logout on first failure)
    expect(screen.getByTestId("authenticated").textContent).toBe("true");

    // Wait 500ms for coalescing window to clear, then 30s for AuthContext retry
    await act(async () => {
      vi.advanceTimersByTime(500 + 30_000);
    });

    // AuthContext 30s retry calls ensureFreshToken again — this time it succeeds
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("token").textContent).toBe("recovered-access");
    expect(localStorage.getItem("auth_token")).toBe("recovered-access");
  });

  it("remains authenticated after all refresh retries are exhausted", async () => {
    const expiresAt = Date.now() + 60_000;
    localStorage.setItem("auth_token", "old-access");
    localStorage.setItem(
      "auth_user",
      JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }),
    );
    localStorage.setItem("auth_refresh_token", "old-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    // 3 total failures: 3 AuthContext attempts x 1 ensureFreshToken fetch each (no internal retry for non-429)
    mockFetch
      .mockResolvedValueOnce(new Response("fail", { status: 500 })) // attempt 1
      .mockResolvedValueOnce(new Response("fail", { status: 500 })) // attempt 2 (30s AuthContext retry)
      .mockResolvedValueOnce(new Response("fail", { status: 500 })); // attempt 3 (60s AuthContext retry)

    // eslint-disable-next-line testing-library/no-unnecessary-act
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

    // Attempt 2: AuthContext retries after 30s (+ 500ms coalescing window)
    await act(async () => {
      vi.advanceTimersByTime(500 + 30_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Attempt 3: AuthContext retries after 60s (+ 500ms coalescing window)
    await act(async () => {
      vi.advanceTimersByTime(500 + 60_000);
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // All retries exhausted — user should STILL be authenticated (no logout)
    expect(screen.getByTestId("authenticated").textContent).toBe("true");
    // Token stays in localStorage (not cleared)
    expect(localStorage.getItem("auth_token")).toBe("old-access");
  });

  it("skips refresh if token is still fresh (freshness guard)", async () => {
    // Use 600s TTL so that at 80% (480s), remaining = 120s > 60s → freshness guard skips
    const expiresAt = Date.now() + 600_000;
    localStorage.setItem("auth_token", "fresh-access");
    localStorage.setItem(
      "auth_user",
      JSON.stringify({ id: "u1", email: "a@b.c", org_id: "org-1", name: null }),
    );
    localStorage.setItem("auth_refresh_token", "some-refresh");
    localStorage.setItem("auth_token_expires_at", String(expiresAt));

    // eslint-disable-next-line testing-library/no-unnecessary-act
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
    // eslint-disable-next-line testing-library/no-unnecessary-act
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
