import { beforeEach, describe, expect, it } from "vitest";

import {
  clearAll,
  getAuthHeaders,
  getLastActivity,
  getRefreshToken,
  getToken,
  getTokenExpiry,
  getUser,
  hardLogout,
  isExpiryKey,
  isTokenKey,
  setLastActivity,
  setRefreshToken,
  setToken,
  setTokenExpiry,
  setUser,
} from "../tokenStorage";
import type { AuthUser } from "../types";

beforeEach(() => {
  localStorage.clear();
});

describe("token get/set", () => {
  it("returns null when no token is stored", () => {
    expect(getToken()).toBeNull();
  });

  it("round-trips a token", () => {
    setToken("abc-123");
    expect(getToken()).toBe("abc-123");
  });
});

describe("refresh token get/set", () => {
  it("returns null when no refresh token is stored", () => {
    expect(getRefreshToken()).toBeNull();
  });

  it("round-trips a refresh token", () => {
    setRefreshToken("refresh-xyz");
    expect(getRefreshToken()).toBe("refresh-xyz");
  });
});

describe("token expiry get/set", () => {
  it("returns null when no expiry is stored", () => {
    expect(getTokenExpiry()).toBeNull();
  });

  it("round-trips a numeric expiry", () => {
    setTokenExpiry(1700000000);
    expect(getTokenExpiry()).toBe(1700000000);
  });
});

describe("last activity get/set", () => {
  it("returns null when no activity timestamp is stored", () => {
    expect(getLastActivity()).toBeNull();
  });

  it("round-trips a timestamp", () => {
    setLastActivity(1700000000);
    expect(getLastActivity()).toBe(1700000000);
  });
});

describe("user get/set", () => {
  const testUser: AuthUser = {
    id: "u-1",
    email: "test@example.com",
    org_id: "org-1",
    name: "Test User",
  };

  it("returns null when no user is stored", () => {
    expect(getUser()).toBeNull();
  });

  it("round-trips a user object", () => {
    setUser(testUser);
    expect(getUser()).toEqual(testUser);
  });

  it("returns null for invalid JSON", () => {
    localStorage.setItem("auth_user", "not-json");
    expect(getUser()).toBeNull();
  });
});

describe("key predicates", () => {
  it("isTokenKey matches the token storage key", () => {
    expect(isTokenKey("auth_token")).toBe(true);
    expect(isTokenKey("other")).toBe(false);
    expect(isTokenKey(null)).toBe(false);
  });

  it("isExpiryKey matches the expiry storage key", () => {
    expect(isExpiryKey("auth_token_expires_at")).toBe(true);
    expect(isExpiryKey("other")).toBe(false);
    expect(isExpiryKey(null)).toBe(false);
  });
});

describe("getAuthHeaders", () => {
  it("returns empty object when no token is stored", () => {
    expect(getAuthHeaders()).toEqual({});
  });

  it("returns Authorization header with Bearer token", () => {
    setToken("my-token");
    expect(getAuthHeaders()).toEqual({ Authorization: "Bearer my-token" });
  });
});

describe("clearAll", () => {
  it("removes all auth keys from localStorage", () => {
    setToken("t");
    setRefreshToken("rt");
    setTokenExpiry(123);
    setLastActivity(456);
    setUser({ id: "u", email: "e", org_id: null, name: null });

    clearAll();

    expect(getToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(getTokenExpiry()).toBeNull();
    expect(getLastActivity()).toBeNull();
    expect(getUser()).toBeNull();
  });
});

describe("hardLogout", () => {
  it("clears storage and redirects to /login", () => {
    setToken("t");

    // Mock window.location
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      writable: true,
      value: { ...originalLocation, href: "" },
    });

    hardLogout();

    expect(getToken()).toBeNull();
    expect(window.location.href).toBe("/login");

    // Restore
    Object.defineProperty(window, "location", {
      writable: true,
      value: originalLocation,
    });
  });
});
