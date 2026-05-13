// Unit tests for the ExpiredTokenBanner component.
//
// Behavior budget for this file (B7): 1 behavior × 2 = 2 tests max.
// Per ADR-031 the banner is non-blocking — accessible via aria-live="polite"
// and role="status" so screen readers announce it without stealing focus.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ExpiredTokenBanner } from "./expired-token-banner.tsx";

describe("ExpiredTokenBanner (B7)", () => {
  afterEach(() => cleanup());

  it("renders the refreshing session banner with non-blocking aria semantics when projection is expired_token", () => {
    render(
      <ExpiredTokenBanner
        projectionState="expired_token"
      />,
    );
    // Text Maya sees while the silent renewal is in flight.
    const banner = screen.getByText("Refreshing your session...");
    expect(banner).toBeTruthy();
    // Non-blocking: announced to AT without stealing focus.
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("renders nothing when projection state is not expired_token", () => {
    const { container } = render(
      <ExpiredTokenBanner projectionState="ready" />,
    );
    // Banner is omitted — no status element in DOM.
    expect(screen.queryByText("Refreshing your session...")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.textContent ?? "").toBe("");
  });
});
