/**
 * Unit tests for the cookie helper used by the ui-cookie-session migration
 * (slices C1/C2). `buildSetCookie` serialises a single `Set-Cookie` value with
 * the exact attribute set the acceptance suite asserts (HttpOnly, SameSite,
 * Path, Max-Age, Secure — and host-only: never a Domain). `parseCookieHeader`
 * decodes an inbound `Cookie:` header into a name→value map so the per-request
 * credential read can fall back to the `auth_token` cookie (D3).
 */

import { describe, expect, it } from "vitest";

import { buildSetCookie, parseCookieHeader } from "./cookies.ts";

describe("buildSetCookie", () => {
  it("serialises the credential cookie with all C1 attributes (dev: no Secure)", () => {
    const value = buildSetCookie("auth_token", "jwt.abc.def", {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 3600,
      secure: false,
    });
    expect(value).toBe(
      "auth_token=jwt.abc.def; Max-Age=3600; Path=/; SameSite=Lax; HttpOnly",
    );
    // Host-only: a Domain attribute must never be emitted.
    expect(value).not.toMatch(/Domain/i);
  });

  it("emits Secure only when requested (prod)", () => {
    const value = buildSetCookie("auth_token", "jwt", {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 3600,
      secure: true,
    });
    expect(value).toContain("; Secure");
  });

  it("serialises the JS-readable flag cookie without HttpOnly", () => {
    const value = buildSetCookie("session", "1", {
      sameSite: "Lax",
      path: "/",
      secure: false,
    });
    expect(value).toBe("session=1; Path=/; SameSite=Lax");
    expect(value).not.toMatch(/HttpOnly/i);
  });

  it("serialises a clearing cookie (empty value + Max-Age=0)", () => {
    expect(buildSetCookie("auth_token", "", { maxAge: 0, path: "/" })).toBe(
      "auth_token=; Max-Age=0; Path=/",
    );
  });
});

describe("parseCookieHeader", () => {
  it("decodes a multi-cookie header into a name→value map", () => {
    expect(parseCookieHeader("auth_token=jwt.abc.def; session=1")).toEqual({
      auth_token: "jwt.abc.def",
      session: "1",
    });
  });

  it("returns an empty map for an absent or empty header", () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader(null)).toEqual({});
    expect(parseCookieHeader("")).toEqual({});
  });

  it("ignores malformed segments without a name", () => {
    expect(parseCookieHeader("; =orphan; auth_token=jwt")).toEqual({
      auth_token: "jwt",
    });
  });
});
