// agent/lib/chat/scope.ts — X-Active-Scope contract per DWD-3 + ADR-029 §4.
//
// The agent extracts the active scope (org_id, project_id, optional
// resource_type + resource_id) from the `X-Active-Scope` request header.
// The header value is a JSON-encoded object whose shape mirrors the
// `ActiveScope` projection field set by ui-state.
//
// During the migration window (US-208 R8 fallback per Luna's review):
//   * SCOPE_HEADER_FALLBACK_ENABLED=true → the body's `project_id` is honored
//     when the header is absent. An observability event identifies the
//     calling client via its User-Agent.
//   * The flag has a HARD compile-time sunset (DWD-3): the module-load
//     assertion below throws when SCOPE_HEADER_FALLBACK_ENABLED=true AND
//     Date.now() has passed SCOPE_HEADER_FALLBACK_SUNSET. This is the R8
//     mitigation — flag-gated kill switches without a hard sunset drift.
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

/**
 * Literal sunset date for the body-fallback migration window per DWD-3 + O6.
 * Set ~6 weeks post-MR-4 merge (2026-05-13 + ~6w = 2026-06-25). The
 * compile-time check below fails-fast the agent's startup once Date.now()
 * has passed this AND SCOPE_HEADER_FALLBACK_ENABLED is still "true".
 *
 * Calendar reminder: `docs/feature/project-and-chat-session-management/
 * deliver/upstream-issues.md` carries the team-calendar note for the
 * flag-removal PR.
 */
export const SCOPE_HEADER_FALLBACK_SUNSET = new Date("2026-06-25T00:00:00Z");

export interface ScopeHeaderFallbackEvent {
  event: "scope_header_fallback_used";
  calling_client: string;
}

/**
 * Module-load assertion enforcing DWD-3's compile-time sunset. The agent
 * imports this at boot AND `handleChat.ts` calls it at module load — two
 * layers so a future refactor that drops one import-site doesn't silently
 * extend the migration window.
 *
 * Behavior:
 *   * SCOPE_HEADER_FALLBACK_ENABLED unset / "false" → no-op (the flag is
 *     already off; the fallback path is dead code).
 *   * SCOPE_HEADER_FALLBACK_ENABLED === "true" AND Date.now() <= sunset →
 *     no-op (we are still inside the migration window).
 *   * SCOPE_HEADER_FALLBACK_ENABLED === "true" AND Date.now() > sunset →
 *     throw Error. The agent's boot crashes; the team is forced to land
 *     the flag-removal PR (a one-line delete) before re-deploying.
 *
 * Tests inject `nowFn` and `flag` to exercise all three branches without
 * mutating process.env.
 */
export function assertScopeHeaderFallbackSunset(
  options: {
    nowFn?: () => number;
    flag?: string | undefined;
    sunset?: Date;
  } = {},
): void {
  const flag = options.flag ?? process.env.SCOPE_HEADER_FALLBACK_ENABLED;
  if (flag !== "true") return;
  const sunset = options.sunset ?? SCOPE_HEADER_FALLBACK_SUNSET;
  const now = options.nowFn ? options.nowFn() : Date.now();
  if (now > sunset.getTime()) {
    throw new Error(
      `SCOPE_HEADER_FALLBACK_SUNSET (${sunset.toISOString()}) has passed. ` +
        `Remove SCOPE_HEADER_FALLBACK_ENABLED + the body-fallback path in ` +
        `agent/lib/chat/scope.ts before re-deploying. See DWD-3.`,
    );
  }
}

export type ExtractScopeOk = {
  ok: true;
  scope: ActiveScope;
  used_body_fallback: boolean;
};

export type ExtractScopeErr = {
  ok: false;
  status: 400 | 403;
  error: string;
};

export type ExtractScopeResult = ExtractScopeOk | ExtractScopeErr;

/**
 * Read X-Active-Scope from the request headers; fall back to body.project_id
 * during the migration window. Per DWD-3 fallback semantics:
 *
 *   header present + well-formed (org_id AND project_id) → use header
 *   header present + malformed                            → 400 (no fallback)
 *   header absent  + flag enabled + body.project_id       → use body
 *   header absent  + flag disabled                        → 400
 *   header.org_id !== X-Org-Id                            → 403 (defense in depth)
 *
 * The org_id mismatch check uses the auth-proxy-injected `X-Org-Id` header.
 * The agent trusts auth-proxy's JWT verification — `X-Org-Id` IS the JWT's
 * org claim by the time the request reaches the agent.
 */
export function extractActiveScope(
  request: Request,
  body: { project_id?: string | null; contextType?: string | null; contextId?: string | null },
  options: { fallbackEnabled?: boolean } = {},
): ExtractScopeResult {
  const fallbackEnabled =
    options.fallbackEnabled ??
    process.env.SCOPE_HEADER_FALLBACK_ENABLED === "true";

  const headerValue =
    request.headers.get("x-active-scope") ?? request.headers.get("X-Active-Scope");
  const orgIdHeader =
    request.headers.get("x-org-id") ?? request.headers.get("X-Org-Id") ?? null;

  if (headerValue && headerValue.length > 0) {
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
      used_body_fallback: false,
      scope: {
        org_id: parsed.org_id,
        project_id: parsed.project_id,
        resource_type: (parsed.resource_type as ResourceType | null) ?? null,
        resource_id: (parsed.resource_id as string | null) ?? null,
      },
    };
  }

  if (fallbackEnabled && body.project_id) {
    // Migration window: the agent still accepts a body-shaped invocation
    // from legacy clients that have not yet updated to send the header.
    // The observability event surfaces the User-Agent so the team can
    // identify holdouts before flipping the flag off.
    if (!orgIdHeader) {
      return {
        ok: false,
        status: 400,
        error:
          "agent invocation missing scope: missing org_id (no X-Active-Scope; no X-Org-Id)",
      };
    }
    // body.contextType / body.contextId carry the legacy dataset-context
    // surface. Resource shape (dataset/view/report) maps directly.
    const resource_type = ((): ResourceType | null => {
      if (body.contextType === "dataset" || body.contextType === "view" || body.contextType === "report") {
        return body.contextType;
      }
      return null;
    })();
    return {
      ok: true,
      used_body_fallback: true,
      scope: {
        org_id: orgIdHeader,
        project_id: body.project_id,
        resource_type,
        resource_id: body.contextId ?? null,
      },
    };
  }

  return {
    ok: false,
    status: 400,
    error:
      "agent invocation missing scope: missing X-Active-Scope header (post-sunset; the body-fallback path is disabled)",
  };
}

/**
 * Build the observability event emitted on the body-fallback path. The
 * agent's logger writes this to its event sink; DEVOPS metric K-J002-5
 * counts these events bucketed by `calling_client` so the team can watch
 * the curve trend to zero before flipping SCOPE_HEADER_FALLBACK_ENABLED
 * off (and then removing this path entirely at the sunset date).
 */
export function buildScopeHeaderFallbackEvent(
  request: Request,
): ScopeHeaderFallbackEvent {
  const userAgent =
    request.headers.get("user-agent") ??
    request.headers.get("User-Agent") ??
    "unknown";
  return {
    event: "scope_header_fallback_used",
    calling_client: userAgent,
  };
}

/**
 * Hono-friendly variant: when callers have a Hono `Context` they can pass
 * it directly. We extract the underlying `Request` and delegate.
 */
export function extractActiveScopeFromContext(
  c: Context,
  body: { project_id?: string | null; contextType?: string | null; contextId?: string | null },
  options: { fallbackEnabled?: boolean } = {},
): ExtractScopeResult {
  return extractActiveScope(c.req.raw, body, options);
}
