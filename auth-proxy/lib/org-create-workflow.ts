/**
 * WorkOS org-create interception workflow (CDO-S5).
 *
 * ADR-048 §1/§3/§5 + ADR-050 §b/§c. The request-side half of the org-create
 * seam (the response side is `applyOrgCreateReissue`). Owns the
 * pre-check → provision → forward → compensate POLICY for AUTH_MODE=workos.
 *
 * Pure of Hono internals — every collaborator is injected, so the whole matrix
 * is fault-injection-testable without standing up the proxy. The retry policy
 * lives HERE (ADR-048 R5): no auto-retry on the non-idempotent org create; ONE
 * retry on the idempotent membership and on the compensation delete.
 */

/** Observability sink — `emitKpiEvent`'s stdout-JSON-line helper in app.ts. */
export type OrgCreateEmit = (event: {
  event: string;
  request_id?: string;
  orphan_org_id?: string;
}) => void;

export interface OrgCreateInterceptionDeps {
  /** Backend org-name availability pre-check; the raw backend Response. */
  checkAvailability: () => Promise<Response>;
  /** Create the WorkOS organization (no auto-retry — not idempotent). */
  provisionOrg: (name: string) => Promise<{ id: string }>;
  /** Bind the verified user to the new org (idempotent — 1 retry here). */
  provisionMembership: (userId: string, orgId: string) => Promise<void>;
  /** Compensation delete of the WorkOS org (best-effort — 1 retry here). */
  deprovisionOrg: (orgId: string) => Promise<void>;
  /** Forward to the backend with X-Org-Id overridden to the new org id; the backend Response. */
  forwardToBackend: (provisionedOrgId: string) => Promise<Response>;
  emit: OrgCreateEmit;
}

export interface OrgCreateInterceptionInput {
  name: string;
  userId: string;
  identityHeaders: Headers;
  correlationId: string;
  deps: OrgCreateInterceptionDeps;
}

/** JSON:API 502 the proxy synthesizes on any WorkOS-egress failure (ADR-050 §c). */
function provisioningFailed(): Response {
  return jsonApi(502, {
    errors: [
      {
        status: "502",
        title: "Organization provisioning failed",
        code: "org_provisioning_failed",
      },
    ],
  });
}

function jsonApi(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Run an async op once, retrying a single time on any rejection. */
async function withOneRetry<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch {
    return await op();
  }
}

/**
 * Run the request-side org-create interception. Returns the Response the proxy
 * relays to the client: a synthesized 409 (name taken) / 502 (WorkOS egress
 * failure), or the backend's create Response relayed verbatim.
 */
export async function runOrgCreateInterception(
  input: OrgCreateInterceptionInput,
): Promise<Response> {
  const { name, userId, correlationId, deps } = input;
  deps.emit({ event: "org_create.intercepted", request_id: correlationId });

  // 1. PRE-CHECK availability. A 409 (name taken) NEVER touches WorkOS.
  const availability = await deps.checkAvailability();
  if (availability.status === 409) {
    return await mirrorConflict(availability);
  }

  // 2. PROVISION the WorkOS org (no auto-retry — not idempotent).
  let orgId: string;
  try {
    const created = await deps.provisionOrg(name);
    orgId = created.id;
  } catch {
    return provisioningFailed();
  }

  // 2b. PROVISION membership (idempotent — 1 retry). On failure after the
  //     retry the org is orphaned → best-effort compensation delete, then 502.
  try {
    await withOneRetry(() => deps.provisionMembership(userId, orgId));
  } catch {
    await bestEffortCompensate(orgId, deps);
    return provisioningFailed();
  }

  // 3. FORWARD to the backend with X-Org-Id = the new org id. Relay verbatim.
  const backend = await deps.forwardToBackend(orgId);
  if (backend.status === 201) {
    return backend;
  }

  // 4. COMPENSATE: a non-201 persist orphans the WorkOS org → best-effort
  //    delete (1 retry). Compensated or not, the client sees the backend
  //    status (ADR-050 §c — indistinguishable).
  await bestEffortCompensate(orgId, deps);
  return backend;
}

/**
 * Best-effort compensation delete (1 retry). On failure, emit the alertable
 * `workos.org_compensate.fail` carrying the orphan id so the orphan is
 * reconcilable out-of-band (ADR-048 §3/§5, A+B best-effort).
 */
async function bestEffortCompensate(
  orgId: string,
  deps: OrgCreateInterceptionDeps,
): Promise<void> {
  try {
    await withOneRetry(() => deps.deprovisionOrg(orgId));
  } catch {
    deps.emit({ event: "workos.org_compensate.fail", orphan_org_id: orgId });
  }
}

/**
 * Mirror the backend's JSON:API 409 (name taken). The backend already emits the
 * canonical shape; relay its body verbatim when it parses, else synthesize a
 * minimal JSON:API 409.
 */
async function mirrorConflict(backend: Response): Promise<Response> {
  let body: unknown;
  try {
    body = await backend.clone().json();
  } catch {
    body = null;
  }
  if (body && typeof body === "object") {
    return jsonApi(409, body);
  }
  return jsonApi(409, {
    errors: [{ status: "409", title: "Organization name is taken" }],
  });
}
