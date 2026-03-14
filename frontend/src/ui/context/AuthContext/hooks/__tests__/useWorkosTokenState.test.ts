import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as tokenStorage from "@/auth/tokenStorage";

vi.mock("@/auth/tokenStorage", () => ({
  getToken: vi.fn(),
  getUser: vi.fn(),
  getRefreshToken: vi.fn(),
  getTokenExpiry: vi.fn(),
  setToken: vi.fn(),
  setRefreshToken: vi.fn(),
  setTokenExpiry: vi.fn(),
  setUser: vi.fn(),
  setLastActivity: vi.fn(),
  getLastActivity: vi.fn(),
  clearAll: vi.fn(),
  hardLogout: vi.fn(),
  getAuthHeaders: vi.fn(),
  isTokenKey: vi.fn((key: string | null) => key === "auth_token"),
  isExpiryKey: vi.fn((key: string | null) => key === "auth_token_expires_at"),
}));

vi.mock("@/auth/tokenRefresh", () => ({
  ensureFreshToken: vi.fn(),
}));

const mockedGetToken = vi.mocked(tokenStorage.getToken);
const mockedGetUser = vi.mocked(tokenStorage.getUser);
const mockedGetRefreshToken = vi.mocked(tokenStorage.getRefreshToken);
const mockedGetTokenExpiry = vi.mocked(tokenStorage.getTokenExpiry);
import { useWorkosTokenState } from "../useWorkosTokenState";

const TEST_USER = { id: "u-1", email: "test@example.com", org_id: "org-1", name: "Test" };

describe("useWorkosTokenState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedGetToken.mockReturnValue(null);
    mockedGetUser.mockReturnValue(null);
    mockedGetRefreshToken.mockReturnValue(null);
    mockedGetTokenExpiry.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initial state", () => {
    it("starts unauthenticated with isLoading false after effect", async () => {
      const { result } = renderHook(() => useWorkosTokenState());
      await vi.advanceTimersByTimeAsync(0);
      expect(result.current.state.isAuthenticated).toBe(false);
      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.state.user).toBeNull();
      expect(result.current.state.token).toBeNull();
    });
  });

  describe("session restore", () => {
    it("restores session from storage", async () => {
      mockedGetToken.mockReturnValue("stored-token");
      mockedGetUser.mockReturnValue(TEST_USER);
      mockedGetRefreshToken.mockReturnValue("stored-refresh");
      mockedGetTokenExpiry.mockReturnValue(Date.now() + 300_000);

      const { result } = renderHook(() => useWorkosTokenState());

      // Wait for useEffect to fire
      await vi.advanceTimersByTimeAsync(0);

      expect(result.current.state.isAuthenticated).toBe(true);
      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.state.user).toEqual(TEST_USER);
      expect(result.current.state.token).toBe("stored-token");
      expect(result.current.state.refreshToken).toBe("stored-refresh");
    });

    it("sets isLoading false when no session found", async () => {
      mockedGetToken.mockReturnValue(null);
      mockedGetUser.mockReturnValue(null);

      const { result } = renderHook(() => useWorkosTokenState());

      await vi.advanceTimersByTimeAsync(0);

      expect(result.current.state.isLoading).toBe(false);
      expect(result.current.state.isAuthenticated).toBe(false);
    });

    it("does not authenticate when token exists but user is missing", async () => {
      mockedGetToken.mockReturnValue("some-token");
      mockedGetUser.mockReturnValue(null);

      const { result } = renderHook(() => useWorkosTokenState());

      await vi.advanceTimersByTimeAsync(0);

      expect(result.current.state.isAuthenticated).toBe(false);
      expect(result.current.state.isLoading).toBe(false);
    });
  });

  describe("proactive refresh", () => {
    // Note: happy-dom runs React effects synchronously, before vi.useFakeTimers()
    // captures setTimeout. So we spy on setTimeout to verify scheduling instead
    // of trying to fire the timers.

    it("schedules a timer when authenticated with expiry", async () => {
      vi.useRealTimers(); // use real timers for this test
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      const expiresAt = Date.now() + 100_000;
      mockedGetToken.mockReturnValue("token");
      mockedGetUser.mockReturnValue(TEST_USER);
      mockedGetRefreshToken.mockReturnValue("refresh");
      mockedGetTokenExpiry.mockReturnValue(expiresAt);

      renderHook(() => useWorkosTokenState());
      await new Promise((r) => setTimeout(r, 0));

      // The proactive refresh effect should have called setTimeout
      const scheduledDelays = setTimeoutSpy.mock.calls.map((c) => c[1]).filter((d) => d != null && d >= 10_000);
      expect(scheduledDelays.length).toBeGreaterThanOrEqual(1);

      // Delay should be ~80% of TTL = 80_000, but at least MIN_REFRESH_DELAY (10_000)
      const refreshDelay = scheduledDelays[0]!;
      expect(refreshDelay).toBeGreaterThanOrEqual(10_000);
      expect(refreshDelay).toBeLessThanOrEqual(100_000);

      setTimeoutSpy.mockRestore();
    });

    it("uses minimum delay when TTL fraction is too small", async () => {
      vi.useRealTimers();
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      // Expires in 5 seconds — 80% = 4s, but MIN_REFRESH_DELAY is 10s
      const expiresAt = Date.now() + 5_000;
      mockedGetToken.mockReturnValue("token");
      mockedGetUser.mockReturnValue(TEST_USER);
      mockedGetRefreshToken.mockReturnValue("refresh");
      mockedGetTokenExpiry.mockReturnValue(expiresAt);

      renderHook(() => useWorkosTokenState());
      await new Promise((r) => setTimeout(r, 0));

      // Should use MIN_REFRESH_DELAY_MS (10_000) since 80% of 5s = 4s < 10s
      const scheduledDelays = setTimeoutSpy.mock.calls.map((c) => c[1]).filter((d) => d != null && d >= 10_000);
      expect(scheduledDelays.length).toBeGreaterThanOrEqual(1);
      expect(scheduledDelays[0]).toBe(10_000);

      setTimeoutSpy.mockRestore();
    });

    it("does not schedule refresh when not authenticated", async () => {
      vi.useRealTimers();
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

      mockedGetToken.mockReturnValue(null);
      mockedGetUser.mockReturnValue(null);

      renderHook(() => useWorkosTokenState());
      await new Promise((r) => setTimeout(r, 0));

      // No long-running timers should be scheduled
      const longDelays = setTimeoutSpy.mock.calls.map((c) => c[1]).filter((d) => d != null && d >= 10_000);
      expect(longDelays).toHaveLength(0);

      setTimeoutSpy.mockRestore();
    });

    it("cleans up timer on unmount", async () => {
      vi.useRealTimers();
      const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

      const expiresAt = Date.now() + 100_000;
      mockedGetToken.mockReturnValue("token");
      mockedGetUser.mockReturnValue(TEST_USER);
      mockedGetRefreshToken.mockReturnValue("refresh");
      mockedGetTokenExpiry.mockReturnValue(expiresAt);

      const { unmount } = renderHook(() => useWorkosTokenState());
      await new Promise((r) => setTimeout(r, 0));

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe("cross-tab sync", () => {
    it("updates state when token refreshed in another tab", async () => {
      mockedGetToken.mockReturnValue("token");
      mockedGetUser.mockReturnValue(TEST_USER);
      mockedGetRefreshToken.mockReturnValue("refresh");
      mockedGetTokenExpiry.mockReturnValue(Date.now() + 300_000);

      const { result } = renderHook(() => useWorkosTokenState());

      await vi.advanceTimersByTimeAsync(0);

      // Simulate storage event from another tab
      const newExpiry = Date.now() + 600_000;
      mockedGetToken.mockReturnValue("tab2-token");
      mockedGetRefreshToken.mockReturnValue("tab2-refresh");

      await act(async () => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "auth_token_expires_at",
            newValue: String(newExpiry),
          }),
        );
      });

      expect(result.current.state.token).toBe("tab2-token");
      expect(result.current.state.refreshToken).toBe("tab2-refresh");
      expect(result.current.state.tokenExpiresAt).toBe(newExpiry);
    });

    it("logs out when token cleared in another tab", async () => {
      mockedGetToken.mockReturnValue("token");
      mockedGetUser.mockReturnValue(TEST_USER);
      mockedGetRefreshToken.mockReturnValue("refresh");
      mockedGetTokenExpiry.mockReturnValue(Date.now() + 300_000);

      const { result } = renderHook(() => useWorkosTokenState());

      await vi.advanceTimersByTimeAsync(0);
      expect(result.current.state.isAuthenticated).toBe(true);

      // Simulate token removal in another tab
      await act(async () => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "auth_token",
            newValue: null,
          }),
        );
      });

      expect(result.current.state.isAuthenticated).toBe(false);
      expect(result.current.state.user).toBeNull();
      expect(result.current.state.token).toBeNull();
    });

    it("ignores storage events when not authenticated", async () => {
      mockedGetToken.mockReturnValue(null);
      mockedGetUser.mockReturnValue(null);

      const { result } = renderHook(() => useWorkosTokenState());

      await vi.advanceTimersByTimeAsync(0);

      // Should not throw or change state
      await act(async () => {
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: "auth_token_expires_at",
            newValue: String(Date.now() + 300_000),
          }),
        );
      });

      expect(result.current.state.isAuthenticated).toBe(false);
    });
  });

  describe("setState", () => {
    it("exposes setState for external state updates", async () => {
      const { result } = renderHook(() => useWorkosTokenState());

      await act(async () => {
        result.current.setState({
          user: TEST_USER,
          token: "manual-token",
          refreshToken: null,
          tokenExpiresAt: null,
          isAuthenticated: true,
          isLoading: false,
        });
      });

      expect(result.current.state.isAuthenticated).toBe(true);
      expect(result.current.state.token).toBe("manual-token");
    });
  });
});
