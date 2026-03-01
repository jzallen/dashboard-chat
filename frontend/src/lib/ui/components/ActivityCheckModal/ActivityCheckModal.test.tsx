import { act,fireEvent, render, screen } from "@testing-library/react";
import { afterEach,beforeEach, describe, expect, it, vi } from "vitest";

import { ActivityCheckModal } from "./index";

describe("ActivityCheckModal", () => {
  let onContinue: ReturnType<typeof vi.fn<() => void>>;
  let onLogout: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    onContinue = vi.fn();
    onLogout = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render when isOpen is false", () => {
    render(
      <ActivityCheckModal isOpen={false} onContinue={onContinue} onLogout={onLogout} />
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders modal with correct content when open", () => {
    render(
      <ActivityCheckModal isOpen={true} onContinue={onContinue} onLogout={onLogout} />
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Are you still there?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log Out" })).toBeInTheDocument();
  });

  it("has correct accessibility attributes", () => {
    render(
      <ActivityCheckModal isOpen={true} onContinue={onContinue} onLogout={onLogout} />
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "activity-check-title");
    expect(dialog).toHaveAttribute("aria-describedby", "activity-check-description");
  });

  it("calls onContinue when Continue button is clicked", () => {
    render(
      <ActivityCheckModal isOpen={true} onContinue={onContinue} onLogout={onLogout} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("calls onLogout when Log Out button is clicked", () => {
    render(
      <ActivityCheckModal isOpen={true} onContinue={onContinue} onLogout={onLogout} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Log Out" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("auto-logs out after 10 minutes with no interaction", () => {
    render(
      <ActivityCheckModal isOpen={true} onContinue={onContinue} onLogout={onLogout} />
    );
    expect(onLogout).not.toHaveBeenCalled();

    // Advance just under 10 minutes — should NOT have logged out
    act(() => {
      vi.advanceTimersByTime(9 * 60 * 1000 + 59 * 1000); // 9:59
    });
    expect(onLogout).not.toHaveBeenCalled();

    // Advance the remaining second
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("does not dismiss on overlay click", () => {
    render(
      <ActivityCheckModal isOpen={true} onContinue={onContinue} onLogout={onLogout} />
    );
    // Click the overlay (dialog element itself, not the card)
    const dialog = screen.getByRole("dialog");
    fireEvent.click(dialog);
    expect(onContinue).not.toHaveBeenCalled();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it("focuses Continue button when modal opens", () => {
    render(
      <ActivityCheckModal isOpen={true} onContinue={onContinue} onLogout={onLogout} />
    );
    expect(screen.getByRole("button", { name: "Continue" })).toHaveFocus();
  });

  it("clears timeout when modal closes", () => {
    const { rerender } = render(
      <ActivityCheckModal isOpen={true} onContinue={onContinue} onLogout={onLogout} />
    );

    // Close the modal
    rerender(
      <ActivityCheckModal isOpen={false} onContinue={onContinue} onLogout={onLogout} />
    );

    // Advance past 10 minutes — should NOT log out since modal was closed
    act(() => {
      vi.advanceTimersByTime(11 * 60 * 1000);
    });
    expect(onLogout).not.toHaveBeenCalled();
  });
});
