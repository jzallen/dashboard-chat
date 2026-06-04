// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";

import { extractCode } from "./bootstrap";
import { clearAll, getToken, setToken } from "./tokenStorage";

describe("tokenStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips the token under the shared auth_token key", () => {
    setToken("jwt.value.here");
    expect(getToken()).toBe("jwt.value.here");
    expect(localStorage.getItem("auth_token")).toBe("jwt.value.here");
  });

  it("records an absolute expiry when expiresIn is given", () => {
    const before = Date.now();
    setToken("jwt", 3600);
    const expiresAt = Number(localStorage.getItem("auth_token_expires_at"));
    expect(expiresAt).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  it("returns null and stores no expiry when none is given", () => {
    setToken("jwt");
    expect(localStorage.getItem("auth_token_expires_at")).toBeNull();
  });

  it("clears both the token and its expiry", () => {
    setToken("jwt", 3600);
    clearAll();
    expect(getToken()).toBeNull();
    expect(localStorage.getItem("auth_token_expires_at")).toBeNull();
  });
});

describe("extractCode", () => {
  it("pulls the dev auth code out of the callback query string", () => {
    expect(extractCode("?code=dev-auth-code")).toBe("dev-auth-code");
  });

  it("returns null when no code is present", () => {
    expect(extractCode("?state=abc")).toBeNull();
  });
});
