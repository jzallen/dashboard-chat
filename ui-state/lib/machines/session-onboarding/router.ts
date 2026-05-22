/**
 * Session-onboarding HTTP transport — per-machine flow router (ADR-041).
 *
 * This is the Anti-Corruption Layer (wave-decisions §1): it translates the
 * Authentication context's wire vocabulary (`X-User-Id`, `Authorization:
 * Bearer`) into the domain's language (`principal_id`, `session_started`).
 * The ACL rule it enforces: identity comes from the verified token / verified
 * header, NEVER a client body claim (L4). `persona_email` is no longer a
 * required production DTO field.
 *
 *   POST /begin            — re-verify the forwarded Bearer + seed the
 *                            projection from session_started (session-onboarding
 *                            is the only `beginsDirectly` machine).
 *   POST /event            — accepts org_form_submitted, retry_clicked, and the
 *                            `__force_failure__` / `__expire_token__` wire
 *                            events under the failure-simulation gate.
 *   POST /open-deep-link   — legacy ScopeResolver path.
 *
 * Design rationale lives in the ADRs (not at the call sites):
 *   - ADR-028  Imports the substrate + orchestrator TYPES only.
 *   - ADR-029  Deep-link scope resolution at the HTTP edge.
 *   - ADR-035  Failure-simulation gate composition.
 *   - ADR-040  FlowStrategy port + the `mountUniformFlowRoutes` substrate;
 *              LEAF-2 alias map keeps the legacy `login-and-org-setup` wire
 *              name resolving during migration.
 *   - ADR-041  Domain realignment to session-onboarding.
 */

import { KNOB, shouldInject } from "@dashboard-chat/shared-failure-simulation";
import type { Context, Hono } from "hono";
import { z } from "zod";

import type { ResolveActiveScope } from "../../active-scope.ts";
import type { Result } from "../../flow-result.ts";
import {
  cryptoRandomId,
  mountUniformFlowRoutes,
} from "../../hexagonal-transport/flow-router.ts";
import type {
  BeginFlowOrchestrator,
  FlowOrchestrator,
} from "../../orchestrator.ts";
import type { FlowEventLog } from "../../persistence/redis.ts";
import type { SessionOnboardingDeps } from "./index.ts";
import { SessionOnboardingBeginStrategy } from "./strategy.ts";

/** The canonical machine name (ADR-039) — also the wire path segment. */
const SESSION_ONBOARDING_MACHINE = "session-onboarding";

/**
 * Context this router consumes from its host app. The composition root sets
 * these variables (and may carry more); the session-onboarding routes require
 * the trusted-ingress identity (`userId`), the forwarded Bearer
 * (`bearerToken`), the reference code, and the parsed body.
 */
export interface SessionOnboardingRouterContext {
  Variables: {
    referenceCode: string;
    userId: string;
    bearerToken: string;
    /** The verified org claim auth-proxy injects via `X-Org-Id` (FIX D1) —
     *  the SOLE source for the `[hasOrg]` returning-user shortcut. Empty
     *  string / absent means "no org" (new user). */
    orgId: string;
    body: unknown;
  };
}

/**
 * Factory the composition root injects so the router can hand the orchestrator
 * pre-built machine deps. The concretions (WorkOS userinfo re-verify, org-create
 * + reissue, silent reauth) stay in the composition root; the router only
 * decides whether to request the forced-failure variant via
 * `forceReissueFailures` (the harness knob, already gated at the edge).
 */
export type BuildLoginDeps = (opts: {
  forceReissueFailures?: number;
}) => SessionOnboardingDeps;

/**
 * Total mapper from the orchestrator's Result API to an HTTP Response. The
 * composition root injects the substrate's `resultToJson` here so the package
 * depends on the orchestrator Result shape, not the transport substrate.
 */
export type SerializeResult = (
  c: Context,
  result: Result<unknown>,
  fallbackError: string,
) => Response;

/**
 * The /begin request DTO. Identity (userId) and the Bearer are trusted-ingress
 * values resolved into context vars by the composition root; the body carries
 * only the org-setup hints. No `persona_email` (L4 — identity is never a client
 * body claim). `persona_email` may still arrive as a harmless dev-fixture hint
 * but is NOT consumed as the identity source.
 */
const beginRequestSchema = z.object({
  referenceCode: z.string(),
  userId: z.string(),
  bearerToken: z.string(),
  // The verified org claim (X-Org-Id). Empty string when absent — treated as
  // "no org" (new user) downstream (FIX D1).
  orgId: z.string(),
  body: z
    .object({
      existing_org_names: z.array(z.string()).optional(),
      force_reissue_failures: z.number().optional(),
    })
    .passthrough(),
});

export type SessionOnboardingRequest = z.infer<typeof beginRequestSchema>;

export function buildSessionOnboardingRouter(
  router: Hono<SessionOnboardingRouterContext>,
  orchestrator: BeginFlowOrchestrator,
  flowOrchestrator: FlowOrchestrator,
  resolveActiveScope: ResolveActiveScope,
  buildLoginDeps: BuildLoginDeps,
  eventLog: FlowEventLog,
  logTransition: (record: Record<string, unknown>) => void,
  serializeResult: SerializeResult,
): Hono<SessionOnboardingRouterContext> {
  router.post("/begin", async (c) => {
    const rawBody = c.get("body");
    const parsed = beginRequestSchema.safeParse({
      referenceCode: c.get("referenceCode"),
      userId: c.get("userId"),
      bearerToken: c.get("bearerToken"),
      orgId: c.get("orgId"),
      body: rawBody ?? {},
    });
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", issues: parsed.error.issues },
        400,
      );
    }
    const request = parsed.data;

    // force-reissue-failures gate: the harness knob that wraps
    // createOrgAndReissue with a failure-injecting counter. Resolve it into
    // machine deps HERE (via the injected factory). Closed-by-default in
    // production (ENVIRONMENT × flag, ADR-035).
    //
    // TODO: consider replacing with contract test and mocked external dependencies
    const reissueFailuresAllowed = shouldInject(KNOB.forceReissueFailures, {
      body: (rawBody ?? {}) as Record<string, unknown>,
      correlationId: request.referenceCode,
      serviceName: "ui-state",
    });
    const deps = buildLoginDeps({
      forceReissueFailures: reissueFailuresAllowed
        ? request.body.force_reissue_failures
        : undefined,
    });
    const strategy = new SessionOnboardingBeginStrategy(
      {
        machine: SESSION_ONBOARDING_MACHINE,
        principal_id: request.userId,
        bearer_token: request.bearerToken,
        // Empty string → "no org" (new user); a non-empty value drives the
        // [hasOrg] returning-user shortcut (FIX D1).
        existing_org_id: request.orgId || null,
        correlation_id: request.referenceCode,
        existing_org_names: request.body.existing_org_names,
      },
      deps,
      eventLog,
      logTransition,
    );
    const result = await orchestrator.begin(strategy);
    return serializeResult(c, result, "begin_failed");
  });

  router.post("/event", async (c) => {
    const correlationId =
      c.req.header("X-Correlation-Id") ?? cryptoRandomId();
    let body: {
      flow_id?: string;
      machine?: string;
      type?: string;
      payload?: Record<string, unknown>;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!body.flow_id || !body.type) {
      return c.json({ error: "flow_id and type required" }, 400);
    }

    // __force_failure__ — drives session-onboarding into error_recoverable
    // with the supplied cause tag. Production must refuse this; the gate is
    // closed-by-default (ENVIRONMENT × flag).
    if (body.type === "__force_failure__") {
      const allowed = shouldInject(KNOB.forceFailureOnAuthRetry, {
        event: { type: body.type },
        correlationId,
        serviceName: "ui-state",
      });
      if (!allowed) {
        return c.json(
          {
            error:
              "failure-simulation knob disabled: __force_failure__ requires the gate enabled (ENVIRONMENT=dev|ci + flag set)",
          },
          403,
        );
      }
    }

    // __expire_token__ — drives ready → expired_token to exercise silent
    // re-auth. Same closed-by-default gate as __force_failure__.
    if (body.type === "__expire_token__") {
      const allowed = shouldInject(KNOB.expireToken, {
        event: { type: body.type },
        correlationId,
        serviceName: "ui-state",
      });
      if (!allowed) {
        return c.json(
          {
            error:
              "failure-simulation knob disabled: __expire_token__ requires the gate enabled (ENVIRONMENT=dev|ci + flag set)",
          },
          403,
        );
      }
    }

    // The body's `machine` (when present) may be the legacy
    // `login-and-org-setup` wire name; the orchestrator's alias map (LEAF-2)
    // canonicalizes it. Default to the canonical name.
    const result = await flowOrchestrator.send({
      machine: body.machine ?? SESSION_ONBOARDING_MACHINE,
      flow_id: body.flow_id,
      type: body.type,
      payload: body.payload ?? {},
      correlation_id: correlationId,
    });
    return serializeResult(c, result, "event_failed");
  });

  // Deep-link / scope-resolution endpoint. The HTTP layer is the canonical
  // place where route params meet the JWT; resolveActiveScope runs here and
  // the resulting scope is appended to the flow's event log.
  router.post("/open-deep-link", async (c) => {
    const correlationId =
      c.req.header("X-Correlation-Id") ?? cryptoRandomId();
    let body: {
      flow_id?: string;
      route?: {
        org?: string;
        project?: string;
        resource_type?: "dataset";
        resource_id?: string;
      };
      project_name?: string;
      bookmarked_project_name?: string;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }

    if (!body.flow_id) {
      return c.json({ error: "flow_id required" }, 400);
    }

    // auth-proxy injects identity headers; in dev X-Org-Id is dev-org-001, in
    // prod it's the verified JWT's org_id claim.
    const userId = c.req.header("X-User-Id") ?? "";
    const orgId = c.req.header("X-Org-Id") ?? null;

    const route = body.route ?? {};
    const resolution = resolveActiveScope(
      route,
      { sub: userId, org_id: orgId },
      {
        bookmarked_project_name: body.bookmarked_project_name ?? null,
        current_project_name: body.project_name ?? null,
      },
    );

    if (!resolution.ok) {
      const result = await flowOrchestrator.appendDeepLinkEvents({
        machine: SESSION_ONBOARDING_MACHINE,
        flow_id: body.flow_id,
        correlation_id: correlationId,
        events: [
          {
            type: "scope_access_denied",
            payload: { reason: "cross-tenant access" },
          },
        ],
      });
      return serializeResult(c, result, "open_deep_link_failed");
    }

    const result = await flowOrchestrator.appendDeepLinkEvents({
      machine: SESSION_ONBOARDING_MACHINE,
      flow_id: body.flow_id,
      correlation_id: correlationId,
      events: [
        {
          type: "deep_link_opened",
          payload: {
            scope: resolution.scope,
            project: route.project
              ? { id: route.project, name: body.project_name ?? null }
              : null,
            reconciled: resolution.reconciled,
          },
        },
      ],
    });
    return serializeResult(c, result, "open_deep_link_failed");
  });

  mountUniformFlowRoutes(router, flowOrchestrator);

  return router;
}
