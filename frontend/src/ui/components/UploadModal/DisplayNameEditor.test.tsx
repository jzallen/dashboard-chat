import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// MR-6 — DisplayNameEditor: edits a source's display name, persisting ONLY the
// display name via the mutation (the underlying filename/`name` is never sent).
// The mutation hook is doubled at the boundary so this isolates the editor's wiring.
const mockMutate = vi.fn();

vi.mock("../../hooks/useDatasetMutations", () => ({
  useUpdateDatasetDisplayName: () => ({ mutate: mockMutate, isPending: false }),
}));

import { DisplayNameEditor } from "./DisplayNameEditor";

describe("DisplayNameEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back to the dataset name when display_name is null", () => {
    render(
      <DisplayNameEditor
        datasetId="ds-1"
        projectId="p-1"
        name="raw_orders"
        displayName={null}
      />,
    );
    expect(screen.getByTestId("display-name-input")).toHaveValue("raw_orders");
  });

  it("shows the display name when one is set", () => {
    render(
      <DisplayNameEditor
        datasetId="ds-1"
        projectId="p-1"
        name="raw_orders"
        displayName="Raw Orders"
      />,
    );
    expect(screen.getByTestId("display-name-input")).toHaveValue("Raw Orders");
  });

  it("saves only the display name via the mutation — never the underlying name", () => {
    render(
      <DisplayNameEditor
        datasetId="ds-1"
        projectId="p-1"
        name="raw_orders"
        displayName={null}
      />,
    );
    fireEvent.change(screen.getByTestId("display-name-input"), {
      target: { value: "Pretty Orders" },
    });
    fireEvent.click(screen.getByTestId("display-name-save"));

    expect(mockMutate).toHaveBeenCalledTimes(1);
    const variables = mockMutate.mock.calls[0][0];
    expect(variables).toMatchObject({
      datasetId: "ds-1",
      displayName: "Pretty Orders",
    });
    // The raw filename/name must never be part of a display-name save.
    expect(variables).not.toHaveProperty("name");
  });
});
