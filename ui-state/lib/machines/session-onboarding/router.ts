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
 *                            `__force_failure__` wire event under the
 *                            failure-simulation gate.
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
import type { ResolveActiveScope } from "../../domain/active-scope.ts";
import { FlowEvent, FlowId } from "../../domain/flow-event.ts";
import type { Result } from "../../domain/flow-result.ts";
import { mountUniformFlowRoutes } from "../../hexagonal-transport/flow-router.ts";
import type {
  BeginFlowOrchestrator,
  FlowOrchestrator,
} from "../../orchestrator.ts";
import type { FlowEventLog } from "../../persistence/redis.ts";
import type { RequestClient } from "./index.ts";
import { isUnderlyingCauseTag } from "./setup/domain.ts";
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
    /** The verified org claim auth-proxy injects via `X-Org-Id` — the SOLE
     *  source for the `[hasOrg]` returning-user shortcut. Empty string /
     *  absent means "no org" (new user). */
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
  // "no org" (new user) downstream.
  orgId: z.string(),
  body: z
    .object({
      force_reissue_failures: z.number().optional(),
    })
    .passthrough(),
});

export type SessionOnboardingRequest = z.infer<typeof beginRequestSchema>;

/** A failure-simulation cause `tag`, validated against the DOMAIN's own closed
 *  vocabulary (D-E2) so the boundary and the failure tags never drift. `.refine`
 *  over the predicate keeps a single source of truth — no re-listed enum. */
const causeTag = z.string().refine(isUnderlyingCauseTag, {
  message: "tag must be a known UnderlyingCauseTag",
});

/**
 * The /event wire DTO — a discriminated union over `type` enumerating the closed
 * set of events an already-running session-onboarding flow accepts (the
 * machine's event union, ADR-041). An unmodeled `type` is rejected at the ACL
 * (400 `invalid_request`); each arm carries only its payload's WELL-FORMEDNESS
 * (string-ness; a known cause tag) while DOMAIN rules (is the org name valid?)
 * stay on the value object (D-E1). `flow_id` is never a wire field, and neither
 * is `machine`: the flow is addressed by `FlowId.of(routeMachine,
 * verifiedPrincipal)` (ADR-040), and the legacy wire alias is canonicalized at
 * `resolve()` against the flow's own minted machine segment — not a body field.
 */
const eventRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("org_form_submitted"),
    payload: z.object({ org_name: z.string() }).passthrough(),
  }),
  z.object({
    type: z.literal("retry_clicked"),
    payload: z.record(z.unknown()).optional(),
  }),
  z.object({
    type: z.literal("__force_failure__"),
    payload: z.object({ tag: causeTag }).passthrough(),
  }),
]);

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
 * composition-root inputs rather than request data: `config` and the
 * `request_client` I/O port. The `[hasOrg]` org binding is NOT taken from the
 * `X-Org-Id` header — that cached JWT claim is logged for audit only; the
 * authoritative org is loaded from the backend (`GET /api/orgs/me`, the org
 * SSOT) during `verifying`. The force-reissue-failures harness knob is gated by
 * `shouldInject` (closed-by-default in production, ENVIRONMENT × flag, ADR-035);
 * its verdict decides whether the body's `force_reissue_failures` count is
 * threaded through to drive `getOrgAndReissue`'s attempt-vs-budget path.
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

    // X-Org-Id is a cached JWT claim, NOT the authoritative org state — the
    // `[hasOrg]` decision is loaded from the backend (`/api/orgs/me`) during
    // `verifying`. Log the claimed org here for audit so claimed-vs-resolved is
    // traceable, but do not feed it into the flow.
    logTransition({
      event: "session_onboarding.org_claim",
      request_id: request.referenceCode,
      principal_id: request.userId,
      claimed_org_id: request.orgId || null,
    });

    const reissueFailuresAllowed = shouldInject(KNOB.forceReissueFailures, {
      body: (rawBody ?? {}) as Record<string, unknown>,
      // `correlationId` is the shared failure-simulation audit-envelope arg
      // (ADR-037); we feed it the request id.
      correlationId: request.referenceCode,
      serviceName: "ui-state",
    });
    const strategy = new SessionOnboardingBeginStrategy(
      {
        flowId: FlowId.of(SESSION_ONBOARDING_MACHINE, request.userId),
        bearer_token: request.bearerToken,
        request_id: request.referenceCode,
        config,
        deps: { request_client: requestClient },
        force_reissue_failures: reissueFailuresAllowed
          ? (request.body.force_reissue_failures ?? null)
          : null,
      },
      eventLog,
      logTransition,
    );
    const result = await orchestrator.begin(strategy);
    return serializeResult(c, result, "begin_failed");
  });

  /**
   * POST /event — forward ONE event to the caller's OWN already-running
   * session-onboarding flow. The target `flow_id` is DERIVED from the verified
   * principal, never accepted from the body (ADR-040). Payload shapes are
   * validated by `eventRequestSchema` at this ACL; domain rules (is the org name
   * valid?) stay on the value object (D-E1). The `__force_failure__` harness
   * event crosses an explicit failure-simulation authorization gate (ADR-035),
   * kept distinct from shape validation. Validation + translation live at this
   * port; the orchestrator core is untouched (ADR-028). See ADR-040 / ADR-041.
   */
  router.post("/event", async (c) => {
    const requestId = c.get("requestId");

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }

    const parsed = eventRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", issues: parsed.error.issues },
        400,
      );
    }
    const event = parsed.data;

    // The flow is addressed by the route's machine-constant + the verified
    // principal (ADR-040): the FlowEvent factory builds the owned FlowId for
    // /event — the router no longer constructs a FlowId directly.
    const flowEvent = FlowEvent.create(
      SESSION_ONBOARDING_MACHINE,
      c.get("userId"),
      {
        type: event.type,
        payload: event.payload,
        request_id: requestId,
      },
    );
    logTransition({
      event: "session_onboarding.event_received",
      request_id: requestId,
      principal_id: c.get("userId") || null,
      flow_id: flowEvent.flowKey,
      event_type: event.type,
    });

    // ADR-035 failure-simulation AUTHORIZATION gate — a policy check kept
    // distinct from shape validation: production cannot drive the forced-failure
    // side-channel even with a well-formed event.
    if (
      event.type === "__force_failure__" &&
      !shouldInject(KNOB.forceFailureOnAuthRetry, {
        event: { type: event.type },
        correlationId: requestId,
        serviceName: "ui-state",
      })
    ) {
      return c.json(
        {
          error:
            "failure-simulation knob disabled: __force_failure__ requires the gate enabled (ENVIRONMENT=dev|ci + flag set)",
        },
        403,
      );
    }

    const result = await flowOrchestrator.send(flowEvent);
    return serializeResult(c, result, "event_failed");
  });

  router.post("/open-deep-link", async (c) => {
    const requestId = c.get("requestId");
    let body: {
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

    const userId = c.req.header("X-User-Id") ?? "";
    const orgId = c.req.header("X-Org-Id") ?? null;
    // flow_id is derived from the verified principal (ADR-040), never accepted
    // from the body — the deep link is always resolved against the caller's
    // own flow.
    const flowId = `${SESSION_ONBOARDING_MACHINE}:${userId}`;

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
        flow_id: flowId,
        request_id: requestId,
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
      flow_id: flowId,
      request_id: requestId,
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

  mountUniformFlowRoutes(router, flowOrchestrator, SESSION_ONBOARDING_MACHINE);

  return router;
}
