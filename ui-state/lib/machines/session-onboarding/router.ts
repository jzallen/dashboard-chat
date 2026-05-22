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

import type { Config } from "../../../config.ts";
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
import type { RequestClient } from "./index.ts";
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

/**
 * Mount the session-onboarding routes onto `router` and return it. Everything
 * the routes need is injected by the composition root: `orchestrator` drives
 * `/begin`; `flowOrchestrator` drives `/event`, `/open-deep-link`, and (via
 * `mountUniformFlowRoutes`) the machine-agnostic substrate routes (`/freeze`,
 * `/thaw`, `/projection`, `/projection/stream`); `config` + `requestClient` are
 * the env config and the `fetch` I/O port the machine resolvers read from their
 * input; `serializeResult` maps the orchestrator Result to an HTTP Response.
 *
 * `/begin` validates the trusted-ingress DTO (identity from headers, never a
 * body claim — the ADR-041 ACL rule) and seeds the `BeginFlowInput` with
 * composition-root inputs rather than request data: `config`, the
 * `request_client` I/O port, and the verified `existing_org_id` (the `X-Org-Id`
 * claim — the SOLE source of the `[hasOrg]` returning-user shortcut, FIX D1; an
 * empty value means "no org" / new user). The force-reissue-failures harness
 * knob is gated by `shouldInject` (closed-by-default in production, ENVIRONMENT ×
 * flag, ADR-035); its verdict decides whether the body's `force_reissue_failures`
 * count is threaded through to drive `getOrgAndReissue`'s attempt-vs-budget path.
 *
 * `/event` closed-by-default-gates the `__force_failure__` / `__expire_token__`
 * harness events (403 when the gate is disabled) so production cannot bypass real
 * auth-flow logic; a legacy `login-and-org-setup` `machine` name is canonicalized
 * by the orchestrator's LEAF-2 alias map.
 *
 * `/open-deep-link` is the HTTP edge where route params meet the JWT:
 * `resolveActiveScope` runs here (identity from the auth-proxy headers — in dev
 * `X-Org-Id` is `dev-org-001`, in prod the verified `org_id` claim) and the
 * resolved scope — or a cross-tenant `scope_access_denied` — is appended to the
 * flow's event log.
 *
 * TODO: consider replacing the failure-simulation gate wiring with a contract
 * test + mocked external dependencies.
 */
export function buildSessionOnboardingRouter(
  router: Hono<SessionOnboardingRouterContext>,
  orchestrator: BeginFlowOrchestrator,
  flowOrchestrator: FlowOrchestrator,
  resolveActiveScope: ResolveActiveScope,
  eventLog: FlowEventLog,
  logTransition: (record: Record<string, unknown>) => void,
  serializeResult: SerializeResult,
  config: Config | null,
  requestClient: RequestClient,
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

    const reissueFailuresAllowed = shouldInject(KNOB.forceReissueFailures, {
      body: (rawBody ?? {}) as Record<string, unknown>,
      correlationId: request.referenceCode,
      serviceName: "ui-state",
    });
    const strategy = new SessionOnboardingBeginStrategy(
      {
        machine: SESSION_ONBOARDING_MACHINE,
        principal_id: request.userId,
        bearer_token: request.bearerToken,
        existing_org_id: request.orgId || null,
        correlation_id: request.referenceCode,
        existing_org_names: request.body.existing_org_names,
        config,
        deps: { request_client: requestClient },
        force_reissue_failures: reissueFailuresAllowed
          ? request.body.force_reissue_failures ?? null
          : null,
      },
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

    const result = await flowOrchestrator.send({
      machine: body.machine ?? SESSION_ONBOARDING_MACHINE,
      flow_id: body.flow_id,
      type: body.type,
      payload: body.payload ?? {},
      correlation_id: correlationId,
    });
    return serializeResult(c, result, "event_failed");
  });

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
