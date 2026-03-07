import { renderHook, act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Dataset } from "@/dataCatalog";

import { useTableConfig } from "../useTableConfig";

function makeDataset(overrides: Partial<Dataset> = {}): Dataset {
  return {
    id: "ds-1",
    project_id: "p-1",
    name: "Test Dataset",
    description: null,
    schema_config: {
      fields: {
        age: { label: "Age", type: "number" },
        name: { label: "Name", type: "text" },
      },
    },
    partition_fields: [],
    transforms: [],
    preview_rows: [
      { age: 25, name: "Alice" },
      { age: 30, name: "Bob" },
    ],
    column_profiles: null,
    ...overrides,
  };
}

describe("useTableConfig", () => {
  it("returns empty columns when no dataset is provided", () => {
    const { result } = renderHook(() => useTableConfig());
    expect(result.current.table.getAllColumns()).toHaveLength(0);
    expect(result.current.data).toEqual([]);
  });

  it("builds columns from dataset schema", () => {
    const dataset = makeDataset();
    const { result } = renderHook(() => useTableConfig({ dataset }));
    const columns = result.current.table.getAllColumns();
    expect(columns).toHaveLength(2);
    expect(columns.map((c) => c.id)).toEqual(["age", "name"]);
  });

  it("uses field labels as column headers", () => {
    const dataset = makeDataset();
    const { result } = renderHook(() => useTableConfig({ dataset }));
    const headers = result.current.table.getAllColumns().map((c) => c.columnDef.header);
    expect(headers).toEqual(["Age", "Name"]);
  });

  it("applies alias transforms to column headers", () => {
    const dataset = makeDataset({
      transforms: [
        {
          id: "t-alias",
          name: "Alias age",
          description: null,
          condition_json: null,
          condition_sql: null,
          status: "enabled",
          transform_type: "alias",
          target_column: "age",
          expression_config: { operation: "alias", alias: "User Age" },
          expression_sql: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const { result } = renderHook(() => useTableConfig({ dataset }));
    const headers = result.current.table.getAllColumns().map((c) => c.columnDef.header);
    expect(headers).toContain("User Age");
    expect(headers).toContain("Name");
  });

  it("ignores disabled alias transforms", () => {
    const dataset = makeDataset({
      transforms: [
        {
          id: "t-alias",
          name: "Alias age",
          description: null,
          condition_json: null,
          condition_sql: null,
          status: "disabled",
          transform_type: "alias",
          target_column: "age",
          expression_config: { operation: "alias", alias: "User Age" },
          expression_sql: null,
          created_at: "2024-01-01T00:00:00Z",
        },
      ],
    });
    const { result } = renderHook(() => useTableConfig({ dataset }));
    const headers = result.current.table.getAllColumns().map((c) => c.columnDef.header);
    expect(headers).toEqual(["Age", "Name"]);
  });

  it("populates data from preview_rows", () => {
    const dataset = makeDataset();
    const { result } = renderHook(() => useTableConfig({ dataset }));
    expect(result.current.data).toEqual([
      { age: 25, name: "Alice" },
      { age: 30, name: "Bob" },
    ]);
  });

  it("exposes setData to update table data", () => {
    const dataset = makeDataset();
    const { result } = renderHook(() => useTableConfig({ dataset }));
    act(() => {
      result.current.setData([{ age: 99, name: "Charlie" }]);
    });
    expect(result.current.data).toEqual([{ age: 99, name: "Charlie" }]);
  });

  it("exposes sorting and setSorting", () => {
    const dataset = makeDataset();
    const { result } = renderHook(() => useTableConfig({ dataset }));
    expect(result.current.sorting).toEqual([]);
    act(() => {
      result.current.setSorting([{ id: "age", desc: true }]);
    });
    expect(result.current.sorting).toEqual([{ id: "age", desc: true }]);
  });

  it("exposes columnFilters and setColumnFilters", () => {
    const dataset = makeDataset();
    const { result } = renderHook(() => useTableConfig({ dataset }));
    expect(result.current.columnFilters).toEqual([]);
    act(() => {
      result.current.setColumnFilters([{ id: "age", value: { operator: "equal", value: 25 } }]);
    });
    expect(result.current.columnFilters).toHaveLength(1);
  });

  it("refresh resolves with current data", async () => {
    const dataset = makeDataset();
    const { result } = renderHook(() => useTableConfig({ dataset }));
    const refreshed = await result.current.refresh();
    expect(refreshed).toEqual(result.current.data);
  });

  it("uses field key as header when label is undefined", () => {
    const dataset = makeDataset({
      schema_config: {
        fields: {
          raw_col: { type: "text" } as any,
        },
      },
    });
    const { result } = renderHook(() => useTableConfig({ dataset }));
    const headers = result.current.table.getAllColumns().map((c) => c.columnDef.header);
    // label is undefined so ?? falls through to key
    expect(headers).toEqual(["raw_col"]);
  });
});
