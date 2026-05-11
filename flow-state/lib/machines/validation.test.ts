// Unit tests for validateOrgName + classifyFailure — pure-function driving
// ports for the J-001 login-and-org-setup machine.
//
// Behavior budget for step 01-02 (2 distinct behaviors):
//   B1 — validateOrgName parses and either yields a ValidatedOrgName or a
//        typed error variant (parametrized over the 4 error kinds + happy).
//   B2 — classifyFailure maps a Failure shape to a closed UnderlyingCauseTag.
//
// Test count budget: 2 behaviors × 2 = 4 unit tests max. Variations of the
// same behavior are parametrized (Mandate 5).

import { describe, it, expect } from "vitest";

import {
  classifyFailure,
  validateOrgName,
  type OrgNameValidationError,
  type UnderlyingCauseTag,
} from "./validation.ts";

describe("validateOrgName — yields ValidatedOrgName or typed error", () => {
  it("accepts a clean name and returns the trimmed value", () => {
    const result = validateOrgName("  Acme Data  ", new Set());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.value).toBe("Acme Data");
    }
  });

  it.each<[string, ReadonlySet<string>, OrgNameValidationError["kind"]]>([
    ["", new Set(), "empty"],
    ["   ", new Set(), "empty"],
    ["a", new Set(), "too_short"],
    ["x".repeat(65), new Set(), "too_long"],
    ["Acme Data", new Set(["Acme Data"]), "duplicate"],
    ["acme data", new Set(["Acme Data"]), "duplicate"], // case-insensitive
  ])(
    "rejects %j (existing=%j) with error kind %j",
    (input, existing, expectedKind) => {
      const result = validateOrgName(input, existing);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.kind).toBe(expectedKind);
      }
    },
  );
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
});
