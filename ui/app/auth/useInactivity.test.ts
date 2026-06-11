// @vitest-environment happy-dom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearLastActivity } from "./tokenStorage";
import { useInactivity } from "./useInactivity";

const DEBOUNCE = 5 * 60 * 1000;
const THRESHOLD = 20 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  clearLastActivity();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("useInactivity", () => {
  it("binds no listeners when signed out", () => {
    const onKeepAlive = vi.fn();
    renderHook(() =>
      useInactivity({ isAuthenticated: false, onLogout: vi.fn(), onKeepAlive }),
    );
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE + 1000);
      document.dispatchEvent(new Event("keydown"));
    });
    expect(onKeepAlive).not.toHaveBeenCalled();
  });

  it("fires the keep-alive at most once per debounce window of activity", () => {
    const onKeepAlive = vi.fn();
    renderHook(() =>
      useInactivity({ isAuthenticated: true, onLogout: vi.fn(), onKeepAlive }),
    );

    // Inside the debounce window (mount stamped activity) → no beat.
    act(() => document.dispatchEvent(new Event("keydown")));
    expect(onKeepAlive).toHaveBeenCalledTimes(0);

    // Past the window → one beat; a second immediate event is debounced out.
    act(() => vi.advanceTimersByTime(DEBOUNCE + 1000));
    act(() => document.dispatchEvent(new Event("keydown")));
    act(() => document.dispatchEvent(new Event("keydown")));
    expect(onKeepAlive).toHaveBeenCalledTimes(1);
  });

  it("opens the modal once idle passes the threshold", () => {
    const { result } = renderHook(() =>
      useInactivity({ isAuthenticated: true, onLogout: vi.fn() }),
    );
    expect(result.current.showModal).toBe(false);
    act(() => vi.advanceTimersByTime(THRESHOLD + 60 * 1000));
    expect(result.current.showModal).toBe(true);
  });

  it("handleContinue closes the modal and fires a keep-alive", () => {
    const onKeepAlive = vi.fn();
    const { result } = renderHook(() =>
      useInactivity({ isAuthenticated: true, onLogout: vi.fn(), onKeepAlive }),
    );
    act(() => vi.advanceTimersByTime(THRESHOLD + 60 * 1000));
    expect(result.current.showModal).toBe(true);

    onKeepAlive.mockClear();
    act(() => result.current.handleContinue());
    expect(result.current.showModal).toBe(false);
    expect(onKeepAlive).toHaveBeenCalledTimes(1);
  });

  it("handleLogout closes the modal and invokes onLogout", () => {
    const onLogout = vi.fn();
    const { result } = renderHook(() =>
      useInactivity({ isAuthenticated: true, onLogout }),
    );
    act(() => result.current.handleLogout());
    expect(onLogout).toHaveBeenCalledTimes(1);
    expect(result.current.showModal).toBe(false);
  });
});
