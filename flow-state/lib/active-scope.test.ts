// Unit tests for resolveActiveScope — the pure-function driving port for
// ScopeResolver. Invariants I1-I5 from ADR-029 are enforced here.
//
// Behavior budget for step 01-01 (walking skeleton): only I1 (no-org case).
// Other invariants are exercised by step 01-03's scope-resolver scenarios.

import { describe, it, expect } from "vitest";

import { resolveActiveScope } from "./active-scope.ts";

describe("resolveActiveScope — no-org case (first-time user)", () => {
  it("returns an empty-org scope when the user has no organization yet", () => {
    const result = resolveActiveScope(
      {},
      { sub: "user_maya_chen", org_id: null },
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope).toEqual({
      org_id: "",
      project_id: null,
      resource_type: null,
      resource_id: null,
    });
    expect(result.reconciled).toBe(false);
  });
});
