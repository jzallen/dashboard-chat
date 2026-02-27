import { fireEvent,render, screen } from "@testing-library/react";
import { vi } from "vitest";

import { Breadcrumb } from "../../../lib/ui/components/DatasetView/Breadcrumb";

describe("Breadcrumb", () => {
  it("renders project and dataset names as static text", () => {
    render(<Breadcrumb projectName="My Project" datasetName="Sales Data" />);
    expect(screen.getByText("My Project")).toBeInTheDocument();
    expect(screen.getByText("Sales Data")).toBeInTheDocument();
  });

  it("clicking dataset name switches to editable input", () => {
    render(
      <Breadcrumb
        projectName="My Project"
        datasetName="Sales Data"
        onDatasetRename={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("Sales Data"));
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue("Sales Data");
  });

  it("shows 'New Dataset' as placeholder text when name is 'New Dataset'", () => {
    render(
      <Breadcrumb
        projectName="My Project"
        datasetName="New Dataset"
        onDatasetRename={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("New Dataset"));
    const input = screen.getByRole("textbox");
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("placeholder", "New Dataset");
  });

  it("calls onDatasetRename on blur with new name", () => {
    const onRename = vi.fn();
    render(
      <Breadcrumb
        projectName="My Project"
        datasetName="Old Name"
        onDatasetRename={onRename}
      />
    );
    fireEvent.click(screen.getByText("Old Name"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "New Name" } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("New Name");
  });

  it("calls onDatasetRename on Enter", () => {
    const onRename = vi.fn();
    render(
      <Breadcrumb
        projectName="My Project"
        datasetName="Old Name"
        onDatasetRename={onRename}
      />
    );
    fireEvent.click(screen.getByText("Old Name"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Renamed");
  });

  it("cancels edit on Escape without calling onDatasetRename", () => {
    const onRename = vi.fn();
    render(
      <Breadcrumb
        projectName="My Project"
        datasetName="Keep This"
        onDatasetRename={onRename}
      />
    );
    fireEvent.click(screen.getByText("Keep This"));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Keep This")).toBeInTheDocument();
  });

  it("does not enter edit mode when onDatasetRename is not provided", () => {
    render(<Breadcrumb projectName="My Project" datasetName="Static" />);
    fireEvent.click(screen.getByText("Static"));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("auto-focuses input when focusDatasetName is true", () => {
    render(
      <Breadcrumb
        projectName="My Project"
        datasetName="New Dataset"
        onDatasetRename={vi.fn()}
        focusDatasetName
      />
    );
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
  });

  it("project name is never editable", () => {
    render(
      <Breadcrumb
        projectName="My Project"
        datasetName="Data"
        onDatasetRename={vi.fn()}
      />
    );
    fireEvent.click(screen.getByText("My Project"));
    // Should not create a textbox
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
