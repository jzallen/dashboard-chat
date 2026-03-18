import { describe, expect, it } from "vitest";

import {
  getTransformIdsForColumn,
  mergeFilters,
  toConditions,
} from "../filterUtils";

describe("toConditions", () => {
  it("wraps a single filter as a one-element array", () => {
    const result = toConditions({ operator: "eq", value: 42 });
    expect(result).toEqual([{ operator: "eq", value: 42 }]);
  });

  it("returns conditions array from compound filter", () => {
    const compound = {
      conditions: [
        { operator: "gt", value: 10 },
        { operator: "lt", value: 100 },
      ],
    };
    expect(toConditions(compound)).toEqual([
      { operator: "gt", value: 10 },
      { operator: "lt", value: 100 },
    ]);
  });

  it("preserves transformId on single condition", () => {
    const result = toConditions({
      operator: "eq",
      value: "x",
      transformId: "t-1",
    });
    expect(result).toEqual([
      { operator: "eq", value: "x", transformId: "t-1" },
    ]);
  });
});

describe("mergeFilters", () => {
  it("adds new filter when column not present", () => {
    const existing = [{ id: "name", value: { operator: "eq", value: "A" } }];
    const incoming = [{ id: "age", value: { operator: "gt", value: 18 } }];

    const result = mergeFilters(existing, incoming);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ id: "age", value: { operator: "gt", value: 18 } });
  });

  it("merges conditions for the same column", () => {
    const existing = [{ id: "age", value: { operator: "gt", value: 10 } }];
    const incoming = [{ id: "age", value: { operator: "lt", value: 100 } }];

    const result = mergeFilters(existing, incoming);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("age");
    const val = result[0].value as { conditions: unknown[] };
    expect(val.conditions).toHaveLength(2);
    expect(val.conditions[0]).toEqual({ operator: "gt", value: 10 });
    expect(val.conditions[1]).toEqual({ operator: "lt", value: 100 });
  });

  it("does not mutate original arrays", () => {
    const existing = [{ id: "name", value: { operator: "eq", value: "A" } }];
    const incoming = [{ id: "age", value: { operator: "gt", value: 1 } }];

    mergeFilters(existing, incoming);

    expect(existing).toHaveLength(1);
  });

  it("handles empty existing filters", () => {
    const result = mergeFilters(
      [],
      [{ id: "name", value: { operator: "eq", value: "B" } }],
    );
    expect(result).toHaveLength(1);
  });

  it("handles empty incoming filters", () => {
    const existing = [{ id: "name", value: { operator: "eq", value: "A" } }];
    const result = mergeFilters(existing, []);
    expect(result).toHaveLength(1);
  });
});

describe("getTransformIdsForColumn", () => {
  it("returns IDs of enabled transforms targeting the column", () => {
    const transforms = [
      {
        id: "t-1",
        status: "enabled",
        condition_json: {
          type: "group",
          children1: {
            r1: { type: "rule", properties: { field: "name", operator: "eq", value: ["X"] } },
          },
        },
      },
      {
        id: "t-2",
        status: "enabled",
        condition_json: {
          type: "group",
          children1: {
            r1: { type: "rule", properties: { field: "age", operator: "gt", value: [10] } },
          },
        },
      },
    ] as any;

    expect(getTransformIdsForColumn(transforms, "name")).toEqual(["t-1"]);
  });

  it("excludes disabled transforms", () => {
    const transforms = [
      {
        id: "t-1",
        status: "disabled",
        condition_json: {
          type: "group",
          children1: {
            r1: { type: "rule", properties: { field: "name", operator: "eq", value: ["X"] } },
          },
        },
      },
    ] as any;

    expect(getTransformIdsForColumn(transforms, "name")).toEqual([]);
  });

  it("returns empty array when no transforms match", () => {
    const transforms = [
      {
        id: "t-1",
        status: "enabled",
        condition_json: {
          type: "group",
          children1: {
            r1: { type: "rule", properties: { field: "other", operator: "eq", value: ["X"] } },
          },
        },
      },
    ] as any;

    expect(getTransformIdsForColumn(transforms, "name")).toEqual([]);
  });

  it("finds columns in nested groups", () => {
    const transforms = [
      {
        id: "t-1",
        status: "enabled",
        condition_json: {
          type: "group",
          children1: {
            g1: {
              type: "group",
              children1: {
                r1: { type: "rule", properties: { field: "name", operator: "eq", value: ["X"] } },
              },
            },
          },
        },
      },
    ] as any;

    expect(getTransformIdsForColumn(transforms, "name")).toEqual(["t-1"]);
  });

  it("excludes transforms with no condition_json", () => {
    const transforms = [
      { id: "t-1", status: "enabled", condition_json: null },
    ] as any;

    expect(getTransformIdsForColumn(transforms, "name")).toEqual([]);
  });
});
