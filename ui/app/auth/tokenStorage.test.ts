// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hasSession } from "./tokenStorage";

/** Drop every cookie the document currently holds (happy-dom is per-file). */
function clearCookies(): void {
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0].trim();
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

describe("hasSession", () => {
  beforeEach(clearCookies);
  afterEach(clearCookies);

  it("returns true when the session=1 flag cookie is present", () => {
    document.cookie = "session=1; Path=/";
    expect(hasSession()).toBe(true);
  });

  it("returns false when no session flag cookie is present", () => {
    expect(hasSession()).toBe(false);
  });

  it("returns true alongside unrelated cookies", () => {
    document.cookie = "other=abc; Path=/";
    document.cookie = "session=1; Path=/";
    expect(hasSession()).toBe(true);
  });

  it("does not match a different cookie whose name merely contains 'session'", () => {
    document.cookie = "mysession=1; Path=/";
    expect(hasSession()).toBe(false);
  });
});
