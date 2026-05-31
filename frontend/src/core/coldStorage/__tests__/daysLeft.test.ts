// daysLeft — pure retention math (MR-7). RED until DELIVER 07-02.
//
// The clock is injected so these assertions are deterministic without faking Date.
import { describe, expect, it } from "vitest";

import { daysLeft } from "../daysLeft";

const NOW = new Date("2026-06-01T00:00:00.000Z");

describe("daysLeft", () => {
  it("returns null when retention_until is null", () => {
    expect(daysLeft(null, NOW)).toBeNull();
  });

  it("returns null when retention_until is undefined", () => {
    expect(daysLeft(undefined, NOW)).toBeNull();
  });

  it("returns the whole days remaining for a future retention end", () => {
    // 2026-06-01 + 10 days = 2026-06-11
    expect(daysLeft("2026-06-11T00:00:00.000Z", NOW)).toBe(10);
  });

  it("rounds a partial day up to the next whole day", () => {
    // 9 days + 12 hours remaining → 10 (ceil)
    expect(daysLeft("2026-06-10T12:00:00.000Z", NOW)).toBe(10);
  });

  it("returns a non-positive count once retention has elapsed", () => {
    expect(daysLeft("2026-05-22T00:00:00.000Z", NOW)).toBeLessThanOrEqual(0);
  });
});
