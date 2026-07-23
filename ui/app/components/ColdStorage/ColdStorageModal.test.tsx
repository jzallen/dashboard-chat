// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ColdStorageItem } from "../../catalog";
import { ColdStorageModal } from "./ColdStorageModal";

const item: ColdStorageItem = {
  id: "src.retired",
  name: "Patients",
  retiredAt: 1_700_000_000_000,
  retentionDays: 90,
  files: [{ name: "patients.csv" }] as ColdStorageItem["files"],
};

const noop = { onRestore: vi.fn(), onClose: vi.fn() };

describe("ColdStorageModal — retired sources list", () => {
  it("renders a playful empty state when nothing is retired", () => {
    render(<ColdStorageModal {...noop} items={[]} />);
    // The empty-state copy invites retiring a source; no rows are shown.
    expect(screen.queryByRole("button", { name: /restore/i })).toBeNull();
    expect(screen.getByText(/wait here/i)).toBeTruthy();
  });

  it("lists each retired source with a Restore action", () => {
    render(<ColdStorageModal {...noop} items={[item]} />);
    expect(screen.getByText("Patients")).toBeTruthy();
    expect(screen.getByRole("button", { name: /restore/i })).toBeTruthy();
  });
});

describe("ColdStorageModal — restore is confirmed (symmetry with archive)", () => {
  it("does NOT restore immediately; it asks for confirmation first", () => {
    const onRestore = vi.fn();
    render(<ColdStorageModal onClose={vi.fn()} onRestore={onRestore} items={[item]} />);

    fireEvent.click(screen.getByRole("button", { name: /restore/i }));

    // No direct restore — a confirm dialog is presented instead.
    expect(onRestore).not.toHaveBeenCalled();
    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs.length).toBeGreaterThan(1); // the modal + the confirm
  });

  it("restores the source once the user confirms", () => {
    const onRestore = vi.fn();
    render(<ColdStorageModal onClose={vi.fn()} onRestore={onRestore} items={[item]} />);

    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    // The confirm's primary action carries the item's name and re-restores it.
    fireEvent.click(screen.getByRole("button", { name: /restore Patients|restore source/i }));

    expect(onRestore).toHaveBeenCalledWith("src.retired");
  });

  it("does not restore when the user cancels the confirmation", () => {
    const onRestore = vi.fn();
    render(<ColdStorageModal onClose={vi.fn()} onRestore={onRestore} items={[item]} />);

    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onRestore).not.toHaveBeenCalled();
  });
});
