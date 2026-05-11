// ScopeResolver — pure-function ActiveScope computation per DWD-4 (Mandate 4).
//
// Per ADR-029, ActiveScope must satisfy invariants I1-I5:
//   I1: active_scope.org_id === jwt.org_id (else 403)
//   I2: active_scope.project_id non-null when project context active
//   I3: (resource_type === null) ↔ (resource_id === null)
//   I4: cross-tenant access → 403 with named diagnostic
//   I5: stale-link reconciliation emits scope_reconciled FlowEvent
//
// Step 01-01 (walking skeleton) exercises ONLY the no-org case (I1 with
// empty org). I2-I5 are exercised by step 01-03's scope-resolver scenarios.

export type ResourceType = "dataset" | "view" | "report";

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

export type ScopeResolution =
  | { ok: true; scope: ActiveScope; reconciled: boolean }
  | { ok: false; reason: "cross_tenant" | "incomplete_resource_pair" };

/**
 * Resolve the ActiveScope for a request.
 *
 * Walking-skeleton case: user has no org claim in JWT → return an empty-org
 * scope with all other dimensions null. Subsequent steps extend this to
 * the I2-I5 cases.
 */
export function resolveActiveScope(
  route: RouteParams,
  jwt: JwtClaims,
  _machineContext: unknown,
): ScopeResolution {
  const orgId = jwt.org_id ?? "";

  // No-org case: user hasn't completed org setup yet. Return empty scope.
  // This is the walking skeleton's only exercised path.
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

  // Cross-tenant guard (I4): route claims an org that differs from JWT.
  if (route.org && route.org !== orgId) {
    return { ok: false, reason: "cross_tenant" };
  }

  // I3: resource_type and resource_id are paired.
  const resourceType = route.resource_type ?? null;
  const resourceId = route.resource_id ?? null;
  if ((resourceType === null) !== (resourceId === null)) {
    return { ok: false, reason: "incomplete_resource_pair" };
  }

  return {
    ok: true,
    scope: {
      org_id: orgId,
      project_id: route.project ?? null,
      resource_type: resourceType,
      resource_id: resourceId,
    },
    reconciled: false,
  };
}
