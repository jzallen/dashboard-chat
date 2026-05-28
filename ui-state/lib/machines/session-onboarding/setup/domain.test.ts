// Unit tests for the OnboardSession domain model (ADR-041): the `OrgName` value
// object (`constructOrgName`) and the failure-cause pair (`failWithCause` /
// `causeOf`).
//
// Behaviors:
//   1. constructOrgName trims, then either yields a valid OrgName value
//      (`.isValid()` true, `.value` the branded name) or a typed rejection
//      (`.getError().kind`), over the 3 shape-error kinds + happy. Duplicate
//      detection is backend-side, not here.
//   2. failWithCause brands a thrown Error with a cause; causeOf reads it back,
//      defaulting untagged / foreign / out-of-union failures to "transient".

import { describe, expect, it } from "vitest";

import {
  causeOf,
  constructOrgName,
  failWithCause,
  type OrgNameRejection,
  type UnderlyingCauseTag,
} from "./domain.ts";

describe("constructOrgName — the OrgName value object", () => {
  it("accepts a clean name: isValid, value is the trimmed OrgName, no error", () => {
    const name = constructOrgName("  Acme Data  ");
    expect(name.isValid()).toBe(true);
    expect(name.value).toBe("Acme Data");
    expect(name.getError()).toBeNull();
  });

  // Shape errors only — duplicate detection moved to the backend (global org-
  // name uniqueness; collision surfaces from the create-org path, covered by the
  // machine + index suites), so constructOrgName yields no "duplicate" kind.
  it.each<[string, OrgNameRejection["kind"]]>([
    ["", "empty"],
    ["   ", "empty"],
    ["a", "too_short"],
    ["x".repeat(65), "too_long"],
  ])("rejects %j: not valid, null value, getError().kind %j", (input, expectedKind) => {
    const name = constructOrgName(input);
    expect(name.isValid()).toBe(false);
    expect(name.value).toBeNull();
    expect(name.getError()?.kind).toBe(expectedKind);
  });
});

describe("failWithCause / causeOf — the failure-cause round-trip", () => {
  const members: UnderlyingCauseTag[] = [
    "transient",
    "cookie-blocked",
    "partial-setup",
    "workos-profile-corrupt",
  ];

  it.each(members)("round-trips a %s cause through the thrown Error", (cause) => {
    const err = failWithCause(cause, `boundary failed: ${cause}`);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe(`boundary failed: ${cause}`);
    expect(causeOf(err)).toBe(cause);
  });

  it.each<[string, unknown]>([
    ["an untagged Error", new Error("backend 500")],
    ["a bare string throw", "boom"],
    ["null", null],
    ["undefined", undefined],
    ["a plain object", {}],
  ])("defaults %s to transient", (_label, error) => {
    expect(causeOf(error)).toBe("transient");
  });

  it("rejects a tag outside the closed union (trust boundary) → transient", () => {
    const spoofed = new Error("spoofed");
    (spoofed as Error & { cause_tag?: string }).cause_tag = "not-a-real-cause";
    expect(causeOf(spoofed)).toBe("transient");
  });
});
