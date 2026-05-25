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
import type { ResolveActiveScope } from "../../active-scope.ts";
import type { Result } from "../../flow-result.ts";
import {
  cryptoRandomId,
  mountUniformFlowRoutes,
} from "../../hexagonal-transport/flow-router.ts";
import type {
  BeginFlowOrchestrator,
  FlowOrchestrator,
  SendEventInput,
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

/**
 * The /event request DTO — the wire vocabulary an already-running flow accepts:
 * the target `flow_id`, an optional `machine` name (the LEAF-2 legacy alias is
 * canonicalized downstream), the event `type`, and an open `payload` carried
 * through to the actor. Mirrors `beginRequestSchema`: a parse failure → 400 with
 * `issues`, replacing the hand-rolled `if (!flow_id || !type)` presence check
 * with `.min(1)` (the same empty-is-missing contract). Per OQ-E3 the schema
 * grows INCREMENTALLY — Slice 1 validates presence only; later slices add
 * `tag` / `org_name` well-formedness at this same boundary.
 */
const eventRequestSchema = z.object({
  flow_id: z.string().min(1),
  machine: z.string().optional(),
  type: z.string().min(1),
  payload: z.record(z.unknown()).optional(),
});

/**
 * Translate a validated wire `/event` request into the typed inbound command the
 * orchestrator's machine-agnostic `send` consumes (OQ-E2: a translation
 * FUNCTION, not a command class — `/event` forwards one event to an
 * already-running actor and has no orchestration to justify a class, D-E1). The
 * structural analogue of `/begin`'s command construction: the wire `machine`
 * alias defaults to the canonical machine name. Identity has already been
 * corroborated against the verified principal by the caller before this runs.
 */
function translateWireEvent(
  event: z.infer<typeof eventRequestSchema>,
  correlationId: string,
): SendEventInput {
  return {
    machine: event.machine ?? SESSION_ONBOARDING_MACHINE,
    flow_id: event.flow_id,
    type: event.type,
    payload: event.payload ?? {},
    correlation_id: correlationId,
  };
}

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
 * `/event` closed-by-default-gates the `__force_failure__` harness event (403
 * when the gate is disabled) so production cannot bypass real
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

    // X-Org-Id is a cached JWT claim, NOT the authoritative org state — the
    // `[hasOrg]` decision is loaded from the backend (`/api/orgs/me`) during
    // `verifying`. Log the claimed org here for audit so claimed-vs-resolved is
    // traceable, but do not feed it into the flow.
    logTransition({
      event: "session_onboarding.org_claim",
      correlation_id: request.referenceCode,
      principal_id: request.userId,
      claimed_org_id: request.orgId || null,
    });

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
        correlation_id: request.referenceCode,
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

    // Structured audit of the inbound event — the /event analogue of /begin's
    // `session_onboarding.org_claim` log (event type + verified principal +
    // target flow + correlation). Identity is logged for traceability only;
    // it is not yet enforced here (the cross-principal guard lands in Slice 5).
    logTransition({
      event: "session_onboarding.event_received",
      correlation_id: correlationId,
      principal_id: c.get("userId") || null,
      flow_id: event.flow_id,
      event_type: event.type,
    });

    // Cross-principal guard (D-E3, OQ-E1 ENFORCE): the aggregate identity is the
    // verified principal's own flow, never a raw body claim (the same L4 ACL
    // rule /begin enforces). When the request carries a verified principal
    // (X-User-Id), the body `flow_id` MUST be the flow that principal owns; a
    // mismatch is rejected at the boundary with 403 before any event can reach
    // another principal's actor. A request without a verified principal falls
    // through unchanged — there is no principal to corroborate the flow against.
    const principalId = c.get("userId");
    if (principalId) {
      const ownFlowId = `${SESSION_ONBOARDING_MACHINE}:${principalId}`;
      if (event.flow_id !== ownFlowId) {
        return c.json(
          {
            error: "forbidden",
            reason: "flow_id does not belong to the verified principal",
          },
          403,
        );
      }
    }

    if (event.type === "__force_failure__") {
      const allowed = shouldInject(KNOB.forceFailureOnAuthRetry, {
        event: { type: event.type },
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

      // The gate is open; now validate the forced cause against the domain's
      // closed failure vocabulary (D-E2) so a tag the projection cannot map
      // never reaches `tagCause` in the actor. The ACL and the domain share one
      // source of truth via the widened-to-export `isUnderlyingCauseTag`.
      const tag = event.payload?.tag;
      if (typeof tag !== "string" || !isUnderlyingCauseTag(tag)) {
        return c.json(
          {
            error: "invalid_request",
            issues: [
              {
                path: ["payload", "tag"],
                message: "tag must be a known UnderlyingCauseTag",
              },
            ],
          },
          400,
        );
      }
    }

    // Payload well-formedness for org_form_submitted (D-E1, OQ-E3 INCREMENTAL):
    // the ACL checks only that the COMMAND is well-formed — `org_name` is a
    // string at all — so a malformed command cannot reach the actor as a silent
    // state change. The DOMAIN rule (is the string a valid name?) deliberately
    // stays on `constructOrgName`: an empty string is well-formed here and still
    // settles to the empty-name validation error in the model, NOT promoted up.
    if (event.type === "org_form_submitted") {
      if (typeof event.payload?.org_name !== "string") {
        return c.json(
          {
            error: "invalid_request",
            issues: [
              {
                path: ["payload", "org_name"],
                message: "org_name must be a string",
              },
            ],
          },
          400,
        );
      }
    }

    const result = await flowOrchestrator.send(
      translateWireEvent(event, correlationId),
    );
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

  mountUniformFlowRoutes(router, flowOrchestrator, SESSION_ONBOARDING_MACHINE);

  return router;
}
