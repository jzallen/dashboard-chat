// Unit tests for resolveActiveScope — the pure-function driving port for
// ScopeResolver. Invariants I1-I5 from ADR-029 are enforced here.
//
// CM-D contract: zero fixtures, zero I/O. Each test calls the resolver
// directly with literal inputs and inspects the discriminated-union return.
//
// Behavior budget (step 01-03):
//   - I1/I4 cross-tenant            (2 tests: pass + fail)
//   - I2 project_id passthrough     (1 test, parametrized across project)
//   - I3 atomic resource pair       (3 tests: both null, both set, partial)
//   - I5 stale-link reconciliation  (3 tests: same name, diff name, no project)
//   - No-org walking-skeleton path  (1 test — already present)
// Total: 10 tests covering 5 invariants ≤ 2× behavior budget.

import { describe, expect,it } from "vitest";

import { resolveActiveScope } from "./active-scope.ts";

describe("resolveActiveScope — no-org case (first-time user, I1 boundary)", () => {
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

describe("resolveActiveScope — I1/I4: route org must match JWT org", () => {
  it("returns ok when route org matches JWT org_id", () => {
    const result = resolveActiveScope(
      { org: "org-acme-data" },
      { sub: "user_maya_chen", org_id: "org-acme-data" },
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope.org_id).toBe("org-acme-data");
  });

  it("returns cross_tenant when route org differs from JWT org_id", () => {
    const result = resolveActiveScope(
      { org: "org-foreign-xyz" },
      { sub: "user_maya_chen", org_id: "org-acme-data" },
      {},
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("cross_tenant");
  });
});

describe("resolveActiveScope — I2: project_id propagates from route", () => {
  it.each([
    ["proj-q4-analytics"],
    ["proj-historical-data"],
    ["proj-some-other-project"],
  ])("scope.project_id reflects route.project (%s)", (projectId) => {
    const result = resolveActiveScope(
      { org: "org-acme-data", project: projectId },
      { sub: "user_maya_chen", org_id: "org-acme-data" },
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope.project_id).toBe(projectId);
  });
});

describe("resolveActiveScope — I3: atomic resource pair", () => {
  it("preserves the resource pair when both type and id are set", () => {
    const result = resolveActiveScope(
      {
        org: "org-acme-data",
        project: "proj-q4-analytics",
        resource_type: "dataset",
        resource_id: "ds-customers",
      },
      { sub: "user_maya_chen", org_id: "org-acme-data" },
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope.resource_type).toBe("dataset");
    expect(result.scope.resource_id).toBe("ds-customers");
  });

  it("drops resource_type when resource_id is absent (partial pair → project-only)", () => {
    const result = resolveActiveScope(
      {
        org: "org-acme-data",
        project: "proj-q4-analytics",
        resource_type: "dataset",
      },
      { sub: "user_maya_chen", org_id: "org-acme-data" },
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope.project_id).toBe("proj-q4-analytics");
    expect(result.scope.resource_type).toBeNull();
    expect(result.scope.resource_id).toBeNull();
  });

  it("drops resource_id when resource_type is absent (partial pair → project-only)", () => {
    const result = resolveActiveScope(
      {
        org: "org-acme-data",
        project: "proj-q4-analytics",
        resource_id: "ds-customers",
      },
      { sub: "user_maya_chen", org_id: "org-acme-data" },
      {},
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scope.resource_type).toBeNull();
    expect(result.scope.resource_id).toBeNull();
  });
});

describe("resolveActiveScope — I5: stale-link reconciliation", () => {
  it("flags reconciled=true when bookmarked project name differs from current", () => {
    const result = resolveActiveScope(
      { org: "org-acme-data", project: "proj-q4-analytics" },
      { sub: "user_maya_chen", org_id: "org-acme-data" },
      {
        bookmarked_project_name: "Q4 Data",
        current_project_name: "Q4 Analytics",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reconciled).toBe(true);
    expect(result.scope.project_id).toBe("proj-q4-analytics");
  });

  it("flags reconciled=false when bookmarked and current names match", () => {
    const result = resolveActiveScope(
      { org: "org-acme-data", project: "proj-q4-analytics" },
      { sub: "user_maya_chen", org_id: "org-acme-data" },
      {
        bookmarked_project_name: "Q4 Analytics",
        current_project_name: "Q4 Analytics",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reconciled).toBe(false);
  });

  it("flags reconciled=false when no project_id is in the route (nothing to reconcile)", () => {
    const result = resolveActiveScope(
      { org: "org-acme-data" },
      { sub: "user_maya_chen", org_id: "org-acme-data" },
      {
        bookmarked_project_name: "Q4 Data",
        current_project_name: "Q4 Analytics",
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reconciled).toBe(false);
  });
});
