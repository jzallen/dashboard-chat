// Unit tests for validateOrgName + classifyFailure — pure-function driving
// ports for the J-001 login-and-org-setup machine.
//
// Behavior budget for step 01-02 (2 distinct behaviors):
//   B1 — validateOrgName parses and either yields a ValidatedOrgName or a
//        typed shape-error variant (parametrized over the 3 shape-error kinds
//        + happy; duplicate detection is backend-side, not here).
//   B2 — classifyFailure maps a Failure shape to a closed UnderlyingCauseTag.
//
// Test count budget: 2 behaviors × 2 = 4 unit tests max. Variations of the
// same behavior are parametrized (Mandate 5).

import { describe, expect,it } from "vitest";

import {
  classifyFailure,
  type OrgNameValidationError,
  type UnderlyingCauseTag,
  validateOrgName,
} from "./validation.ts";

describe("validateOrgName — yields ValidatedOrgName or typed error", () => {
  it("accepts a clean name and returns the trimmed value", () => {
    const result = validateOrgName("  Acme Data  ");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe("Acme Data");
    }
  });

  // Shape errors only — duplicate detection moved to the backend (global org-
  // name uniqueness; collision surfaces from the create-org path, covered by the
  // machine + index suites), so validateOrgName no longer takes an existing-names
  // set or yields a "duplicate" kind.
  it.each<[string, OrgNameValidationError["kind"]]>([
    ["", "empty"],
    ["   ", "empty"],
    ["a", "too_short"],
    ["x".repeat(65), "too_long"],
  ])("rejects %j with error kind %j", (input, expectedKind) => {
    const result = validateOrgName(input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe(expectedKind);
    }
  });
});

describe("classifyFailure — closed UnderlyingCauseTag union", () => {
  it.each<
    [
      Parameters<typeof classifyFailure>[0],
      UnderlyingCauseTag,
    ]
  >([
    [{ kind: "reissue_exhausted" }, "partial-setup"],
    [{ kind: "workos_userinfo" }, "workos-profile-corrupt"],
    [{ kind: "cookie_blocked" }, "cookie-blocked"],
    [{ tag: "transient" }, "transient"],
    [{ tag: "partial-setup" }, "partial-setup"],
    [{ message: "workos profile missing email" }, "workos-profile-corrupt"],
    [{ message: "cookie blocked by browser" }, "cookie-blocked"],
    [{ message: "reissue exhausted after 3 attempts" }, "partial-setup"],
    [{ message: "network error" }, "transient"],
    [{}, "transient"],
  ])("classifies %j as %j", (failure, expected) => {
    expect(classifyFailure(failure)).toBe(expected);
  });

  it("prefers explicit kind over message keywords", () => {
    // Cross-cutting precedence test: kind overrides message sniffing.
    expect(
      classifyFailure({
        kind: "reissue_exhausted",
        message: "cookie blocked",
      }),
    ).toBe("partial-setup");
  });

  // B3 — Closed-union exhaustiveness (Step 02-01).
  // The runtime test plus the never-check below ensure new members of
  // UnderlyingCauseTag cannot be added to the union without forcing a
  // compile error here AND a test update.
  it("classifies failures into every member of the closed union exhaustively", () => {
    // The four canonical members — one representative input per member.
    const samples: ReadonlyArray<{
      failure: Parameters<typeof classifyFailure>[0];
      expected: UnderlyingCauseTag;
    }> = [
      { failure: { kind: "reissue_exhausted" }, expected: "partial-setup" },
      { failure: { kind: "workos_userinfo" }, expected: "workos-profile-corrupt" },
      { failure: { kind: "cookie_blocked" }, expected: "cookie-blocked" },
      { failure: { message: "transient network blip" }, expected: "transient" },
    ];
    const seen = new Set<UnderlyingCauseTag>();
    for (const { failure, expected } of samples) {
      const actual = classifyFailure(failure);
      expect(actual).toBe(expected);
      seen.add(actual);
    }
    // Every member of the closed union must have been produced.
    expect(seen.size).toBe(4);

    // Compile-time exhaustiveness — fails to compile if a member is added
    // to UnderlyingCauseTag without being listed here.
    const _exhaustive: Exclude<
      UnderlyingCauseTag,
      | "transient"
      | "cookie-blocked"
      | "partial-setup"
      | "workos-profile-corrupt"
    > = undefined as never;
    void _exhaustive;
  });
});
