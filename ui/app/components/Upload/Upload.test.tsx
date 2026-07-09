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
          type_mismatch: [{ column: "age", expected: "number", actual: "text" }],
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
    const retry = screen.getByRole("button", { name: /different file|retry|try again/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalled();
  });

  it("renders no mismatch banner when there is no mismatch", () => {
    render(<UploadModal {...noopProps} source={existingSource} mismatch={null} />);
    expect(screen.queryByRole("alert")).toBe(null);
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
