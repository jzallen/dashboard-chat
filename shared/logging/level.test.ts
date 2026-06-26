import { describe, expect, it } from "vitest";

import { DEFAULT_LOG_LEVEL, resolveLogLevel } from "./level";

describe("resolveLogLevel", () => {
  it("defaults to info when LOG_LEVEL is unset", () => {
    expect(resolveLogLevel()).toBe("info");
    expect(resolveLogLevel({})).toBe("info");
    expect(DEFAULT_LOG_LEVEL).toBe("info");
  });

  it("maps each valid level", () => {
    for (const level of ["debug", "info", "warn", "error"] as const) {
      expect(resolveLogLevel({ LOG_LEVEL: level })).toBe(level);
    }
  });

  it("matches case-insensitively and trims whitespace", () => {
    expect(resolveLogLevel({ LOG_LEVEL: "DEBUG" })).toBe("debug");
    expect(resolveLogLevel({ LOG_LEVEL: "  Warn " })).toBe("warn");
  });

  it("falls back to info on an unrecognized or empty level", () => {
    expect(resolveLogLevel({ LOG_LEVEL: "verbose" })).toBe("info");
    expect(resolveLogLevel({ LOG_LEVEL: "" })).toBe("info");
  });
});
