import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const mockedSetToken = vi.mocked(tokenStorage.setToken);
const mockedSetUser = vi.mocked(tokenStorage.setUser);
const mockedSetRefreshToken = vi.mocked(tokenStorage.setRefreshToken);
const mockedSetTokenExpiry = vi.mocked(tokenStorage.setTokenExpiry);

import { useDevTokenState } from "../useDevTokenState";

describe("useDevTokenState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets dev credentials after mount", async () => {
    const { result } = renderHook(() => useDevTokenState());

    await act(async () => {});

    expect(result.current.state.isAuthenticated).toBe(true);
    expect(result.current.state.isLoading).toBe(false);
    expect(result.current.state.token).toBe("dev-token-static");
    expect(result.current.state.user).toEqual({
      id: "dev-user-001",
      email: "dev@localhost",
      org_id: "dev-org-001",
      name: "Dev User",
    });
  });

  it("persists dev token to storage", async () => {
    renderHook(() => useDevTokenState());

    await act(async () => {});

    expect(mockedSetToken).toHaveBeenCalledWith("dev-token-static");
    expect(mockedSetUser).toHaveBeenCalledWith({
      id: "dev-user-001",
      email: "dev@localhost",
      org_id: "dev-org-001",
      name: "Dev User",
    });
    expect(mockedSetRefreshToken).toHaveBeenCalledWith("dev-refresh-token-001");
    expect(mockedSetTokenExpiry).toHaveBeenCalledWith(expect.any(Number));
  });

  it("sets expiry ~5 minutes in the future", async () => {
    const before = Date.now();
    renderHook(() => useDevTokenState());

    await act(async () => {});

    const expiryArg = mockedSetTokenExpiry.mock.calls[0][0];
    // Should be approximately 5 minutes (300,000ms) from now
    expect(expiryArg).toBeGreaterThanOrEqual(before + 299_000);
    expect(expiryArg).toBeLessThanOrEqual(before + 301_000);
  });

  it("sets refresh token in state", async () => {
    const { result } = renderHook(() => useDevTokenState());

    await act(async () => {});

    expect(result.current.state.refreshToken).toBe("dev-refresh-token-001");
  });

  it("sets tokenExpiresAt in state", async () => {
    const before = Date.now();
    const { result } = renderHook(() => useDevTokenState());

    await act(async () => {});

    expect(result.current.state.tokenExpiresAt).toBeGreaterThanOrEqual(before + 299_000);
  });

  it("exposes setState for external updates", async () => {
    const { result } = renderHook(() => useDevTokenState());

    await act(async () => {});

    await act(async () => {
      result.current.setState((prev) => ({ ...prev, token: "overridden" }));
    });

    expect(result.current.state.token).toBe("overridden");
  });
});
