import { describe, expect, it, vi } from "vitest";

import type { BackendClient } from "../../lib/chat/backend-client";
import {
  fetchTableSchema,
  mapSchemaConfigToColumns,
  mapTransformsToActiveCleaning,
} from "../../lib/chat/datasetSchema";

describe("mapSchemaConfigToColumns", () => {
  it("maps schema_config.fields to TableSchema columns (id = column name, type from spec)", () => {
    const columns = mapSchemaConfigToColumns({
      fields: {
        email: { type: "text" },
        age: { type: "number", label: "Age" },
        active: { type: "boolean" },
        signed_up: { type: "datetime" },
        tier: { type: "select" },
      },
    });

    expect(columns).toEqual([
      { id: "email", type: "string" },
      { id: "age", type: "number" },
      { id: "active", type: "boolean" },
      { id: "signed_up", type: "date" },
      { id: "tier", type: "string" },
    ]);
  });

  it("defaults unknown/missing field types to string", () => {
    const columns = mapSchemaConfigToColumns({
      fields: { weird: { type: "mystery" }, bare: {} },
    });
    expect(columns).toEqual([
      { id: "weird", type: "string" },
      { id: "bare", type: "string" },
    ]);
  });

  it("returns an empty array when fields are absent", () => {
    expect(mapSchemaConfigToColumns({})).toEqual([]);
    expect(mapSchemaConfigToColumns(undefined)).toEqual([]);
  });
});

describe("mapTransformsToActiveCleaning", () => {
  it("maps response transforms to activeCleaningTransforms entries", () => {
    const active = mapTransformsToActiveCleaning([
      {
        id: "t1",
        transform_type: "clean",
        target_column: "email",
        status: "enabled",
        nl_prompt: "lowercase email",
      },
      {
        id: "t2",
        transform_type: "map",
        target_column: "tier",
        status: "enabled",
      },
    ]);

    expect(active).toEqual([
      { id: "t1", column: "email", operation: "clean", details: "lowercase email" },
      { id: "t2", column: "tier", operation: "map" },
    ]);
  });

  it("drops deleted transforms and tolerates an absent list", () => {
    expect(
      mapTransformsToActiveCleaning([
        { id: "t1", transform_type: "clean", target_column: "x", status: "deleted" },
      ]),
    ).toEqual([]);
    expect(mapTransformsToActiveCleaning(undefined)).toEqual([]);
  });
});

describe("fetchTableSchema", () => {
  it("GETs the dataset with transforms and maps the response into a TableSchema", async () => {
    const get = vi.fn(async () => ({
      schema_config: { fields: { email: { type: "text" } } },
      transforms: [
        { id: "t1", transform_type: "clean", target_column: "email", status: "enabled" },
      ],
    }));
    const backend = { get, post: vi.fn() } as unknown as BackendClient;

    const schema = await fetchTableSchema("ds-42", backend);

    expect(get).toHaveBeenCalledWith("/api/datasets/ds-42?include_transforms=true");
    expect(schema.columns).toEqual([{ id: "email", type: "string" }]);
    expect(schema.activeCleaningTransforms).toEqual([
      { id: "t1", column: "email", operation: "clean" },
    ]);
    // client-ephemeral hints are left empty; rowCount tolerates absence
    expect(schema.activeFilters ?? []).toEqual([]);
    expect(typeof schema.rowCount).toBe("number");
  });
});
