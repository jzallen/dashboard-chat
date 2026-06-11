// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hasSession } from "./tokenStorage";
import { _resetUnauthorizedForTests, handleUnauthorized } from "./unauthorized";

function stubLocation(pathname: string): { assign: ReturnType<typeof vi.fn> } {
  const loc = { assign: vi.fn(), pathname };
  Object.defineProperty(window, "location", { configurable: true, value: loc });
  return loc;
}

beforeEach(() => {
  _resetUnauthorizedForTests();
  document.cookie = "session=1; path=/";
});
afterEach(() => {
  document.cookie = "session=; path=/; max-age=0";
});

describe("handleUnauthorized", () => {
  it("clears the session flag and navigates to /login", () => {
    const loc = stubLocation("/onboarding");
    expect(hasSession()).toBe(true);

    handleUnauthorized();

    expect(hasSession()).toBe(false);
    expect(loc.assign).toHaveBeenCalledWith("/login");
  });

  it("fires exactly once across a burst of 401s", () => {
    const loc = stubLocation("/");
    handleUnauthorized();
    handleUnauthorized();
    handleUnauthorized();
    expect(loc.assign).toHaveBeenCalledTimes(1);
  });

  it("does not redirect when already on /login (no loop)", () => {
    const loc = stubLocation("/login");
    handleUnauthorized();
    expect(loc.assign).not.toHaveBeenCalled();
  });
});
