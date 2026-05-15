// ScopeResolver — pure-function ActiveScope computation per DWD-4 (Mandate 4).
//
// Per ADR-029, ActiveScope must satisfy invariants I1-I5:
//   I1: active_scope.org_id === jwt.org_id (else 403/cross_tenant)
//   I2: active_scope.project_id non-null when project context active
//   I3: (resource_type === null) ↔ (resource_id === null) — atomic pair
//   I4: cross-tenant access → 403 with named diagnostic (same machinery as I1
//       at the route layer; deeper cross-tenant check — does the project_id
//       belong to a foreign org? — is enforced by the backend's
//       authorize_project_access dependency which returns 403)
//   I5: stale-link reconciliation emits scope_reconciled FlowEvent when the
//       project_id resolves to a name that differs from the bookmarked name
//
// Step 01-01 (walking skeleton) exercises ONLY the no-org case (I1 with
// empty org). Step 01-03 extends to the full I1-I5 surface.
//
// CM-D contract: this function has ZERO fixture/IO dependency. Its unit
// tests run with no Redis, no backend, no network.

// `ResourceType` is YAGNI-collapsed to the single literal `"dataset"` per
// ADR-039 §Q1. The alias name is retained so call sites read structurally;
// the shape `resource: { type: ResourceType | null; id: string | null }` stays
// polymorphism-ready for the day a second resource type actually ships.
export type ResourceType = "dataset";

export interface ActiveScope {
  org_id: string;
  project_id: string | null;
  resource_type: ResourceType | null;
  resource_id: string | null;
}

export interface RouteParams {
  org?: string;
  project?: string;
  resource_type?: ResourceType;
  resource_id?: string;
}

export interface JwtClaims {
  sub: string;
  org_id: string | null;
}

/**
 * MachineContext is the slice of per-flow state the resolver needs. The
 * resolver does not read the full XState context — only the fields named
 * here, which are guaranteed to be loaded by the orchestrator before any
 * scope resolution.
 */
export interface MachineContext {
  /**
   * The current name of `route.project` as known to the user's machine.
   * Used for I5: when the route's bookmarked project name differs from
   * the current name, the resolver flags `reconciled: true`.
   */
  current_project_name?: string | null;
  /**
   * The bookmarked name the user's URL carries (in URL state or query
   * params). When present and != current_project_name, reconciliation
   * fires.
   */
  bookmarked_project_name?: string | null;
}

export type ScopeResolution =
  | { ok: true; scope: ActiveScope; reconciled: boolean }
  | { ok: false; reason: "cross_tenant" };

/**
 * Resolve the ActiveScope for a request.
 *
 * Decision matrix:
 *  - No org claim AND no route.org → empty-org scope (walking-skeleton path).
 *  - Route names an org different from JWT → cross_tenant (I1, I4).
 *  - Route has resource_type without resource_id (or vice versa) → I3 policy:
 *    drop the partial resource pair and fall back to project-only scope.
 *    Rationale: malformed deep links should not error; they should degrade.
 *    See acceptance scenario "Maya's deep link with a resource type but no
 *    resource id is treated as a project-only link".
 *  - Project resolved + bookmarked_project_name != current_project_name → set
 *    reconciled=true (I5). The HTTP layer emits the scope_reconciled FlowEvent.
 */
export function resolveActiveScope(
  route: RouteParams,
  jwt: JwtClaims,
  machineContext: MachineContext = {},
): ScopeResolution {
  const orgId = jwt.org_id ?? "";

  // No-org case: user hasn't completed org setup yet. Return empty scope.
  if (orgId === "" && !route.org) {
    return {
      ok: true,
      scope: {
        org_id: "",
        project_id: null,
        resource_type: null,
        resource_id: null,
      },
      reconciled: false,
    };
  }

  // I1 / I4 (route layer): route claims an org that differs from JWT.
  // (The "project belongs to a different tenant" variant of I4 — where
  // route.org matches but the project_id is owned by another org — is
  // enforced by the backend's authorize_project_access guard; the resolver
  // here only catches the URL-vs-JWT mismatch.)
  if (route.org && route.org !== orgId) {
    return { ok: false, reason: "cross_tenant" };
  }

  // I3 atomic resource pair: when only one half is present, drop both and
  // keep the project-only scope. Acceptance contract: no error, just degrade.
  let resourceType: ResourceType | null = route.resource_type ?? null;
  let resourceId: string | null = route.resource_id ?? null;
  if ((resourceType === null) !== (resourceId === null)) {
    resourceType = null;
    resourceId = null;
  }

  // I5 stale-link reconciliation: when the bookmarked project name differs
  // from the current project name, flag reconciled=true so the caller can
  // emit a scope_reconciled FlowEvent. Reconciliation only applies when a
  // project_id resolved successfully — without one, there is nothing to
  // reconcile against.
  const projectId = route.project ?? null;
  const reconciled =
    projectId !== null &&
    typeof machineContext.bookmarked_project_name === "string" &&
    typeof machineContext.current_project_name === "string" &&
    machineContext.bookmarked_project_name !==
      machineContext.current_project_name;

  return {
    ok: true,
    scope: {
      org_id: orgId,
      project_id: projectId,
      resource_type: resourceType,
      resource_id: resourceId,
    },
    reconciled,
  };
}
