import { describe, expect,it } from "vitest";

import { type Dataset,datasetToSparse } from "../../lib/api/datasets";

function mockDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "d-1",
    project_id: "p-1",
    name: "Test Dataset",
    description: "A test dataset",
    schema_config: { fields: { col1: { type: "text" } } },
    partition_fields: [],
    transforms: [],
    preview_rows: [],
    ...overrides,
  };
}

describe("datasetToSparse", () => {
  it("extracts sparse fields from a full dataset", () => {
    const dataset = mockDataset({ id: "d-new", name: "Uploaded" });
    const sparse = datasetToSparse(dataset);
    expect(sparse).toEqual({
      id: "d-new",
      name: "Uploaded",
      link: "/api/datasets/d-new",
      description: "A test dataset",
      schema_config: { fields: { col1: { type: "text" } } },
    });
  });

  it("handles null description", () => {
    const dataset = mockDataset({ description: null });
    const sparse = datasetToSparse(dataset);
    expect(sparse.description).toBeNull();
  });

  it("builds correct link from dataset id", () => {
    const dataset = mockDataset({ id: "abc-123" });
    const sparse = datasetToSparse(dataset);
    expect(sparse.link).toBe("/api/datasets/abc-123");
  });
});
