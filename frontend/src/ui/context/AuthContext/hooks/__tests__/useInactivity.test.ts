import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as tokenStorage from "@/auth/tokenStorage";

import { useInactivity } from "../useInactivity";

vi.mock("@/auth/tokenStorage", () => ({
  getLastActivity: vi.fn(),
  setLastActivity: vi.fn(),
}));

const mockedGetLastActivity = vi.mocked(tokenStorage.getLastActivity);
const mockedSetLastActivity = vi.mocked(tokenStorage.setLastActivity);

describe("useInactivity", () => {
  const logout = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockedGetLastActivity.mockReturnValue(Date.now());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does nothing when not authenticated", () => {
    const { result } = renderHook(() => useInactivity(false, logout));

    expect(result.current.showModal).toBe(false);
    expect(mockedSetLastActivity).not.toHaveBeenCalled();
  });

  it("initializes last activity when none exists", () => {
    mockedGetLastActivity.mockReturnValue(null);

    renderHook(() => useInactivity(true, logout));

    expect(mockedSetLastActivity).toHaveBeenCalledWith(expect.any(Number));
  });

  it("does not re-initialize activity when it already exists", () => {
    mockedGetLastActivity.mockReturnValue(1000);

    renderHook(() => useInactivity(true, logout));

    // setLastActivity should not be called for initialization
    expect(mockedSetLastActivity).not.toHaveBeenCalled();
  });

  it("registers activity event listeners on document", () => {
    const addSpy = vi.spyOn(document, "addEventListener");

    renderHook(() => useInactivity(true, logout));

    const registeredEvents = addSpy.mock.calls.map((c) => c[0]);
    expect(registeredEvents).toContain("mousedown");
    expect(registeredEvents).toContain("keydown");
    expect(registeredEvents).toContain("scroll");
    expect(registeredEvents).toContain("touchstart");

    addSpy.mockRestore();
  });

  it("removes event listeners on cleanup", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");

    const { unmount } = renderHook(() => useInactivity(true, logout));
    unmount();

    const removedEvents = removeSpy.mock.calls.map((c) => c[0]);
    expect(removedEvents).toContain("mousedown");
    expect(removedEvents).toContain("keydown");
    expect(removedEvents).toContain("scroll");
    expect(removedEvents).toContain("touchstart");

    removeSpy.mockRestore();
  });

  it("shows modal after inactivity threshold", () => {
    // Activity was 20+ minutes ago
    const twentyOneMinutesAgo = Date.now() - 21 * 60 * 1000;
    mockedGetLastActivity.mockReturnValue(twentyOneMinutesAgo);

    const { result } = renderHook(() => useInactivity(true, logout));

    expect(result.current.showModal).toBe(false);

    // Advance past the 1-minute check interval
    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });

    expect(result.current.showModal).toBe(true);
  });

  it("does not show modal before threshold", () => {
    // Activity was 10 minutes ago (below 20-min threshold)
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    mockedGetLastActivity.mockReturnValue(tenMinutesAgo);

    const { result } = renderHook(() => useInactivity(true, logout));

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });

    expect(result.current.showModal).toBe(false);
  });

  it("handleContinue resets activity and hides modal", () => {
    const twentyOneMinutesAgo = Date.now() - 21 * 60 * 1000;
    mockedGetLastActivity.mockReturnValue(twentyOneMinutesAgo);

    const { result } = renderHook(() => useInactivity(true, logout));

    // Trigger modal
    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(result.current.showModal).toBe(true);

    // Continue
    act(() => {
      result.current.handleContinue();
    });

    expect(result.current.showModal).toBe(false);
    expect(mockedSetLastActivity).toHaveBeenCalledWith(expect.any(Number));
  });

  it("handleLogout hides modal and calls logout", () => {
    const twentyOneMinutesAgo = Date.now() - 21 * 60 * 1000;
    mockedGetLastActivity.mockReturnValue(twentyOneMinutesAgo);

    const { result } = renderHook(() => useInactivity(true, logout));

    // Trigger modal
    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });

    act(() => {
      result.current.handleLogout();
    });

    expect(result.current.showModal).toBe(false);
    expect(logout).toHaveBeenCalledOnce();
  });

  it("clears interval on cleanup", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");

    const { unmount } = renderHook(() => useInactivity(true, logout));
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
