// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FlashedNodeProvider, useFlashedNode } from "./FlashedNodeProvider";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <FlashedNodeProvider>{children}</FlashedNodeProvider>;
}

describe("useFlashedNode", () => {
  it("throws when used outside a FlashedNodeProvider", () => {
    expect(() => renderHook(() => useFlashedNode())).toThrow(
      /must be used within a FlashedNodeProvider/,
    );
  });

  it("clears the flashed node ~1.6s after flash()", () => {
    const { result } = renderHook(() => useFlashedNode(), { wrapper });

    act(() => result.current.flash("n1"));
    expect(result.current.flashedNodeId).toBe("n1");

    act(() => vi.advanceTimersByTime(1600));
    expect(result.current.flashedNodeId).toBeNull();
  });

  it("a rapid second flash resets the timer so the first does not clear it early", () => {
    const { result } = renderHook(() => useFlashedNode(), { wrapper });

    act(() => result.current.flash("first"));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.flash("second"));

    // The first flash's 1600ms window would have elapsed by now (1000+800),
    // but the second flash restarted the countdown, so "second" is still lit.
    act(() => vi.advanceTimersByTime(800));
    expect(result.current.flashedNodeId).toBe("second");

    act(() => vi.advanceTimersByTime(800));
    expect(result.current.flashedNodeId).toBeNull();
  });

  it("does not fire the clear callback after unmount (no setState-after-unmount)", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, unmount } = renderHook(() => useFlashedNode(), { wrapper });

    act(() => result.current.flash("n1"));
    unmount();

    // The pending timer must have been cleared on unmount; advancing time must
    // not attempt a setState on the torn-down component.
    act(() => vi.advanceTimersByTime(2000));
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
