// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LineageNode } from "../../catalog";
import { UploadModal } from "./Upload";

const existingSource: LineageNode = {
  id: "src.real",
  label: "Patients",
  sub: "source",
  layer: "source",
  schema: [{ name: "name", type: "text" }],
  files: [],
};

const noopProps = {
  onClose: vi.fn(),
  onCreateSource: vi.fn(),
  onRename: vi.fn(),
  onArchive: vi.fn(),
};

describe("UploadModal — schema-mismatch recovery UX (slice 5)", () => {
  it("shows the offending columns and a retry / pick-a-different-file affordance when a mismatch is present", () => {
    const onRetry = vi.fn();
    render(
      <UploadModal
        {...noopProps}
        source={existingSource}
        mismatch={{
          missing: ["active"],
          extra: ["email"],
          type_mismatch: [
            { column: "age", expected: "number", actual: "text" },
          ],
        }}
        onRetry={onRetry}
      />,
    );

    // The mismatch detail is surfaced to the user (not just a generic "Failed").
    const banner = screen.getByRole("alert");
    const text = banner.textContent ?? "";
    expect(text.toLowerCase()).toContain("schema");
    expect(text).toContain("active"); // missing
    expect(text).toContain("email"); // extra
    expect(text).toContain("age"); // type mismatch

    // A retry / pick-a-different-file affordance is offered.
    const retry = screen.getByRole("button", {
      name: /different file|retry|try again/i,
    });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalled();
  });

  it("renders no mismatch banner when there is no mismatch", () => {
    render(
      <UploadModal {...noopProps} source={existingSource} mismatch={null} />,
    );
    expect(screen.queryByRole("alert")).toBe(null);
  });
});

describe("UploadModal — seeded persisted upload history", () => {
  const seeded = [
    { name: "jan.csv", rows: 100, when: "Jan 5", status: "ingested" },
    { name: "feb.csv", rows: null, when: "Feb 14", status: "pending" },
  ];

  it("renders the seeded persisted files oldest-first, a pending file showing no row count", () => {
    render(
      <UploadModal {...noopProps} source={existingSource} files={seeded} />,
    );

    const rows = screen.getAllByText(/\.csv$/).map((el) => el.textContent);
    expect(rows).toEqual(["jan.csv", "feb.csv"]);

    // The ingested file shows its row count; the still-pending file shows no
    // count (a "processing…" placeholder), never a misleading "0 rows".
    expect(screen.getByText("100 rows")).toBeTruthy();
    expect(screen.getByText("processing…")).toBeTruthy();
    expect(screen.queryByText("0 rows")).toBe(null);
  });

  it("appends a fresh in-session upload AFTER the seeded history, preserving the earlier order", async () => {
    render(
      <UploadModal {...noopProps} source={existingSource} files={seeded} />,
    );

    // Drive a fresh upload through the browse → schema flow.
    fireEvent.click(
      screen.getByRole("button", { name: /upload another file/i }),
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["a,b\n1,2\n3,4"], "mar.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });

    // Once the fresh row lands, it sits AFTER the seeded rows (persisted-first).
    // The modal's dial-up upload animation runs ~1.5s, past findByText's 1s default.
    await screen.findByText("mar.csv", {}, { timeout: 4000 });
    const order = screen.getAllByText(/\.csv$/).map((el) => el.textContent);
    expect(order).toEqual(["jan.csv", "feb.csv", "mar.csv"]);
  });

  it("keeps the empty 'No files yet' state when no persisted files are seeded", () => {
    render(<UploadModal {...noopProps} source={existingSource} />);
    expect(screen.getByText(/no files yet/i)).toBeTruthy();
  });
});

describe("UploadModal — section ordering", () => {
  it("renders the Schema section BEFORE the Files section in the DOM", () => {
    const { container } = render(
      <UploadModal {...noopProps} source={existingSource} />,
    );

    const body = container.textContent ?? "";
    const schemaIdx = body.indexOf("Schema");
    const filesIdx = body.indexOf("Files");
    expect(schemaIdx).toBeGreaterThanOrEqual(0);
    expect(filesIdx).toBeGreaterThanOrEqual(0);
    expect(schemaIdx).toBeLessThan(filesIdx);
  });
});
