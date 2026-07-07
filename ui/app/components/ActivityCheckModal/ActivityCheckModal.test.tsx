// @vitest-environment happy-dom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivityCheckModal } from "./ActivityCheckModal";

afterEach(() => vi.useRealTimers());

describe("ActivityCheckModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <ActivityCheckModal
        isOpen={false}
        onContinue={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("Continue and Log out invoke their handlers", () => {
    const onContinue = vi.fn();
    const onLogout = vi.fn();
    render(
      <ActivityCheckModal isOpen onContinue={onContinue} onLogout={onLogout} />,
    );
    expect(screen.getByText(/are you still there/i)).toBeTruthy();

    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("Log out"));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("auto-logs-out after the grace timer", () => {
    vi.useFakeTimers();
    const onLogout = vi.fn();
    render(
      <ActivityCheckModal isOpen onContinue={vi.fn()} onLogout={onLogout} />,
    );
    expect(onLogout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(10 * 60 * 1000 + 1000));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("honors an injected grace timeout", () => {
    vi.useFakeTimers();
    const onLogout = vi.fn();
    render(
      <ActivityCheckModal
        isOpen
        onContinue={vi.fn()}
        onLogout={onLogout}
        timeoutMs={1000}
      />,
    );
    act(() => vi.advanceTimersByTime(500));
    expect(onLogout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(600));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the previously-focused element when it closes", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { rerender } = render(
      <ActivityCheckModal isOpen onContinue={vi.fn()} onLogout={vi.fn()} />,
    );
    expect(document.activeElement).toBe(screen.getByText("Continue"));

    rerender(
      <ActivityCheckModal
        isOpen={false}
        onContinue={vi.fn()}
        onLogout={vi.fn()}
      />,
    );
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
});
