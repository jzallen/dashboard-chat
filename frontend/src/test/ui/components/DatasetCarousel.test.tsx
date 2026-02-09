import { render, screen, fireEvent } from "@testing-library/react";
import { DatasetGrid } from "../../../lib/ui/components/DatasetView/DatasetCarousel";
import { MOCK_DATASETS } from "../../../__mocks__/data";

describe("DatasetGrid", () => {
  it("renders all datasets as cards", () => {
    render(
      <DatasetGrid
        datasets={MOCK_DATASETS}
        selectedDatasetId={null}
        onSelect={vi.fn()}
        hasSelection={false}
      />
    );
    expect(screen.getByText("Sales Data")).toBeInTheDocument();
    expect(screen.getByText("Inventory")).toBeInTheDocument();
    expect(screen.getByText("Returns")).toBeInTheDocument();
  });

  it("highlights selected dataset", () => {
    render(
      <DatasetGrid
        datasets={MOCK_DATASETS}
        selectedDatasetId="ds-002"
        onSelect={vi.fn()}
        hasSelection={true}
      />
    );
    const selectedCard = screen.getByText("Inventory").closest("button");
    expect(selectedCard?.className).toContain("cardSelected");
  });

  it("calls onSelect when card clicked", () => {
    const onSelect = vi.fn();
    render(
      <DatasetGrid
        datasets={MOCK_DATASETS}
        selectedDatasetId={null}
        onSelect={onSelect}
        hasSelection={false}
      />
    );
    fireEvent.click(screen.getByText("Returns"));
    expect(onSelect).toHaveBeenCalledWith("ds-003");
  });

  it("renders row count and field count", () => {
    render(
      <DatasetGrid
        datasets={MOCK_DATASETS}
        selectedDatasetId={null}
        onSelect={vi.fn()}
        hasSelection={false}
      />
    );
    expect(screen.getByText("1,500 rows")).toBeInTheDocument();
    expect(screen.getAllByText("6 fields")).toHaveLength(3);
  });

  it("uses grid layout when no selection", () => {
    const { container } = render(
      <DatasetGrid
        datasets={MOCK_DATASETS}
        selectedDatasetId={null}
        onSelect={vi.fn()}
        hasSelection={false}
      />
    );
    const scrollArea = container.querySelector("[class*='scrollAreaGrid']");
    expect(scrollArea).toBeInTheDocument();
  });

  it("uses row layout when selection exists", () => {
    const { container } = render(
      <DatasetGrid
        datasets={MOCK_DATASETS}
        selectedDatasetId="ds-001"
        onSelect={vi.fn()}
        hasSelection={true}
      />
    );
    const scrollArea = container.querySelector("[class*='scrollAreaRow']");
    expect(scrollArea).toBeInTheDocument();
  });
});
