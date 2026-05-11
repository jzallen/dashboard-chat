// SCAFFOLD: true
//
// ScopeResolver — pure-function scaffold per DWD-4 (Mandate 4).
//
// Per ADR-029, ActiveScope must satisfy invariants I1-I5:
//   I1: active_scope.org_id === jwt.org_id (else 403)
//   I2: active_scope.project_id non-null when project context active
//   I3: (resource_type === null) ↔ (resource_id === null)
//   I4: cross-tenant access → 403 with named diagnostic
//   I5: stale-link reconciliation emits scope_reconciled FlowEvent
//
// This function is the SINGLE place these invariants are enforced. The HTTP
// layer (index.ts) and the route loaders both call into it; neither
// re-derives scope.

export const __SCAFFOLD__ = true;

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

export function resolveActiveScope(
  _route: RouteParams,
  _jwt: JwtClaims,
  _machineContext: unknown,
): ScopeResolution {
  throw new Error("Not yet implemented — RED scaffold");
}
