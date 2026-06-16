// agent/lib/chat/scope.ts — X-Active-Scope contract per DWD-3 + ADR-029 §4.
//
// The agent extracts the active scope (org_id, project_id, optional
// resource_type + resource_id) from the `X-Active-Scope` request header.
// The header value is a JSON-encoded object whose shape mirrors the
// `ActiveScope` projection field set by ui-state. The header is the
// EXCLUSIVE source of scope — the legacy body.project_id migration fallback
// has been removed now that the migration window has closed.
//
// Defense in depth: when the header IS present, this helper validates that
// `X-Active-Scope.org_id === X-Org-Id` (the auth-proxy-injected identity).
// A mismatch returns 403 even when the JWT itself authenticates the request
// — the user must NOT be allowed to operate on a scope outside their own
// tenant via header forgery (ADR-029 invariant 4 cross-tenant guard).

import type { Context } from "hono";

export type ResourceType = "dataset" | "view" | "report";

export interface ActiveScope {
  org_id: string;
  project_id: string;
  resource_type: ResourceType | null;
  resource_id: string | null;
}

export type ExtractScopeOk = {
  ok: true;
  scope: ActiveScope;
};

export type ExtractScopeErr = {
  ok: false;
  status: 400 | 403;
  error: string;
};

export type ExtractScopeResult = ExtractScopeOk | ExtractScopeErr;

/**
 * Read X-Active-Scope from the request headers. Per the X-Active-Scope
 * contract (header-only enforcement):
 *
 *   header present + well-formed (org_id AND project_id) → use header
 *   header present + malformed                            → 400
 *   header absent                                         → 400
 *   header.org_id !== X-Org-Id                            → 403 (defense in depth)
 *
 * The org_id mismatch check uses the auth-proxy-injected `X-Org-Id` header.
 * The agent trusts auth-proxy's JWT verification — `X-Org-Id` IS the JWT's
 * org claim by the time the request reaches the agent.
 */
export function extractActiveScope(request: Request): ExtractScopeResult {
  const headerValue =
    request.headers.get("x-active-scope") ?? request.headers.get("X-Active-Scope");
  const orgIdHeader =
    request.headers.get("x-org-id") ?? request.headers.get("X-Org-Id") ?? null;

  if (!headerValue || headerValue.length === 0) {
    return {
      ok: false,
      status: 400,
      error:
        "agent invocation missing scope: missing X-Active-Scope header",
    };
  }

  let parsed: Partial<ActiveScope>;
  try {
    parsed = JSON.parse(headerValue) as Partial<ActiveScope>;
  } catch {
    return {
      ok: false,
      status: 400,
      error: "agent invocation missing scope: malformed X-Active-Scope header",
    };
  }
  if (!parsed.org_id || typeof parsed.org_id !== "string") {
    return {
      ok: false,
      status: 400,
      error: "agent invocation missing scope: missing org_id",
    };
  }
  if (!parsed.project_id || typeof parsed.project_id !== "string") {
    return {
      ok: false,
      status: 400,
      error: "agent invocation missing scope: missing project_id",
    };
  }
  // Defense in depth: when both X-Active-Scope and X-Org-Id are present,
  // they MUST agree. auth-proxy injects X-Org-Id from the verified JWT;
  // a header-forging client cannot escape its own tenant via X-Active-Scope.
  if (orgIdHeader && parsed.org_id !== orgIdHeader) {
    return {
      ok: false,
      status: 403,
      error:
        "agent invocation rejected: X-Active-Scope.org_id does not match JWT org_id",
    };
  }
  return {
    ok: true,
    scope: {
      org_id: parsed.org_id,
      project_id: parsed.project_id,
      resource_type: (parsed.resource_type as ResourceType | null) ?? null,
      resource_id: (parsed.resource_id as string | null) ?? null,
    },
  };
}

/**
 * Hono-friendly variant: when callers have a Hono `Context` they can pass
 * it directly. We extract the underlying `Request` and delegate.
 */
export function extractActiveScopeFromContext(c: Context): ExtractScopeResult {
  return extractActiveScope(c.req.raw);
}
