import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as tokenStorage from "@/auth/tokenStorage";

vi.mock("@/auth/tokenStorage", () => ({
  setToken: vi.fn(),
  setUser: vi.fn(),
  setRefreshToken: vi.fn(),
  setTokenExpiry: vi.fn(),
  getToken: vi.fn(),
  getUser: vi.fn(),
  getRefreshToken: vi.fn(),
  getTokenExpiry: vi.fn(),
  getLastActivity: vi.fn(),
  setLastActivity: vi.fn(),
  clearAll: vi.fn(),
  hardLogout: vi.fn(),
  getAuthHeaders: vi.fn(),
  isTokenKey: vi.fn(),
  isExpiryKey: vi.fn(),
}));

vi.mock("@/http/config", () => ({
  DATA_CATALOG_BASE_URL: "",
}));

const mockedSetToken = vi.mocked(tokenStorage.setToken);
const mockedSetUser = vi.mocked(tokenStorage.setUser);
const mockedSetRefreshToken = vi.mocked(tokenStorage.setRefreshToken);
const mockedSetTokenExpiry = vi.mocked(tokenStorage.setTokenExpiry);

const MOCK_CALLBACK_RESPONSE = {
  token: "eyJ.mock.jwt",
  user: {
    id: "dev-user-001",
    email: "dev@localhost",
    org_id: "dev-org-001",
    name: "Dev User",
  },
  refresh_token: "dev-refresh-token-001",
  expires_in: 300,
};

import { useDevTokenState } from "../useDevTokenState";

describe("useDevTokenState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(MOCK_CALLBACK_RESPONSE),
      })
    );
  });

  it("fetches JWT from /api/auth/callback on mount", async () => {
    renderHook(() => useDevTokenState());

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/auth/callback",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "dev-auth-code" }),
        })
      );
    });
  });

  it("sets credentials from callback response", async () => {
    const { result } = renderHook(() => useDevTokenState());

    await waitFor(() => {
      expect(result.current.state.isAuthenticated).toBe(true);
    });

    expect(result.current.state.isLoading).toBe(false);
    expect(result.current.state.token).toBe("eyJ.mock.jwt");
    expect(result.current.state.user).toEqual(MOCK_CALLBACK_RESPONSE.user);
  });

  it("persists token and user to storage", async () => {
    renderHook(() => useDevTokenState());

    await waitFor(() => {
      expect(mockedSetToken).toHaveBeenCalledWith("eyJ.mock.jwt");
    });

    expect(mockedSetUser).toHaveBeenCalledWith(MOCK_CALLBACK_RESPONSE.user);
    expect(mockedSetRefreshToken).toHaveBeenCalledWith("dev-refresh-token-001");
    expect(mockedSetTokenExpiry).toHaveBeenCalledWith(expect.any(Number));
  });

  it("sets expiry ~5 minutes in the future", async () => {
    const before = Date.now();
    renderHook(() => useDevTokenState());

    await waitFor(() => {
      expect(mockedSetTokenExpiry).toHaveBeenCalled();
    });

    const expiryArg = mockedSetTokenExpiry.mock.calls[0][0];
    // expires_in=300 → 300_000ms from now
    expect(expiryArg).toBeGreaterThanOrEqual(before + 299_000);
    expect(expiryArg).toBeLessThanOrEqual(before + 301_000);
  });

  it("sets refresh token in state", async () => {
    const { result } = renderHook(() => useDevTokenState());

    await waitFor(() => {
      expect(result.current.state.refreshToken).toBe("dev-refresh-token-001");
    });
  });

  it("sets tokenExpiresAt in state", async () => {
    const before = Date.now();
    const { result } = renderHook(() => useDevTokenState());

    await waitFor(() => {
      expect(result.current.state.tokenExpiresAt).toBeGreaterThanOrEqual(before + 299_000);
    });
  });

  it("exposes setState for external updates", async () => {
    const { result } = renderHook(() => useDevTokenState());

    await waitFor(() => {
      expect(result.current.state.isAuthenticated).toBe(true);
    });

    await act(async () => {
      result.current.setState((prev) => ({ ...prev, token: "overridden" }));
    });

    expect(result.current.state.token).toBe("overridden");
  });

  it("handles fetch failure gracefully", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network error"))
    );

    const { result } = renderHook(() => useDevTokenState());

    await waitFor(() => {
      expect(result.current.state.isLoading).toBe(false);
    });

    expect(result.current.state.isAuthenticated).toBe(false);
    expect(result.current.state.token).toBeNull();
  });
});
