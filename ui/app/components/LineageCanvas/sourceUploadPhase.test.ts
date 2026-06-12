import { describe, expect, it } from "vitest";

import {
  isInFlightPhase,
  sourceUploadPhaseLabel,
} from "./sourceUploadPhase";

describe("sourceUploadPhaseLabel", () => {
  it("maps each saga phase to a human-readable in-flight label", () => {
    expect(sourceUploadPhaseLabel("creating_source")).toBe("Creating…");
    expect(sourceUploadPhaseLabel("uploading")).toBe("Uploading…");
    expect(sourceUploadPhaseLabel("processing")).toBe("Processing…");
    expect(sourceUploadPhaseLabel("linked")).toBe("Linked");
    expect(sourceUploadPhaseLabel("error_recoverable")).toBe("Failed");
  });

  it("returns null for the idle phase (no badge to render)", () => {
    expect(sourceUploadPhaseLabel("idle")).toBeNull();
  });
});

describe("isInFlightPhase", () => {
  it("is true while the saga is advancing or errored, false at idle/linked", () => {
    expect(isInFlightPhase("creating_source")).toBe(true);
    expect(isInFlightPhase("uploading")).toBe(true);
    expect(isInFlightPhase("processing")).toBe(true);
    expect(isInFlightPhase("error_recoverable")).toBe(true);
    expect(isInFlightPhase("idle")).toBe(false);
    expect(isInFlightPhase("linked")).toBe(false);
  });
});
