import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AssistantChangesPanel } from "./AssistantChangesPanel";

// MR-5 — AssistantChangesPanel: the prominent "Assistant changes" audit panel.
describe("AssistantChangesPanel", () => {
  it("renders the panel with one entry per change", () => {
    render(
      <AssistantChangesPanel
        changes={[
          { id: "tc-1", tool: "filterTable", summary: "column=status, value=active" },
          { id: "tc-2", tool: "sortTable", summary: "column=amount, direction=desc" },
        ]}
      />,
    );
    expect(screen.getByTestId("assistant-changes-panel")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-change-0")).toHaveTextContent("filterTable");
    expect(screen.getByTestId("assistant-change-0")).toHaveTextContent("status");
    expect(screen.getByTestId("assistant-change-1")).toHaveTextContent("sortTable");
  });

  it("renders an explicit empty-state when no changes are recorded", () => {
    render(<AssistantChangesPanel changes={[]} />);
    expect(screen.getByTestId("assistant-changes-panel")).toBeInTheDocument();
    expect(screen.getByTestId("assistant-changes-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("assistant-change-0")).not.toBeInTheDocument();
  });
});
