import { describe, expect, it } from "vitest";

import { QUERY_STALE_TIMES } from "../queryConfig";

describe("QUERY_STALE_TIMES", () => {
  it("exports all expected keys", () => {
    expect(QUERY_STALE_TIMES).toHaveProperty("PROJECT");
    expect(QUERY_STALE_TIMES).toHaveProperty("DATASET_LIST");
    expect(QUERY_STALE_TIMES).toHaveProperty("DATASET_DETAIL");
    expect(QUERY_STALE_TIMES).toHaveProperty("TRANSFORMS");
    expect(QUERY_STALE_TIMES).toHaveProperty("SQL_ACCESS");
  });

  it("all values are positive numbers", () => {
    for (const value of Object.values(QUERY_STALE_TIMES)) {
      expect(value).toBeGreaterThan(0);
      expect(typeof value).toBe("number");
    }
  });

  it("DATASET_DETAIL stale time is longer than DATASET_LIST", () => {
    expect(QUERY_STALE_TIMES.DATASET_DETAIL).toBeGreaterThan(
      QUERY_STALE_TIMES.DATASET_LIST,
    );
  });
});
