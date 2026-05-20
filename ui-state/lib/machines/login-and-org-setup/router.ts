/**
 * Login-and-org-setup HTTP transport — per-machine flow router.
 *
 * Owns the login-specific endpoints (`/begin`, `/event`, `/open-deep-link`);
 * the shared substrate at `hexagonal-transport/flow-router.ts` mounts the
 * machine-agnostic routes (`/freeze`, `/thaw`, `/projection`,
 * `/projection/stream`).
 *
 *   POST /begin            — direct WorkOS + org-create begin (login is
 *                            the only `beginsDirectly` machine);
 *                            persona_email is mandatory.
 *   POST /event            — accepts `__force_failure__` and
 *                            `__expire_token__` wire events under the
 *                            failure-simulation gate.
 *   POST /open-deep-link   — legacy ScopeResolver path; the intent-shaped
 *                            branch lives on project-context.
 *
 * Design rationale lives in the ADRs (not at the call sites):
 *   - ADR-028  This module imports the substrate + orchestrator TYPES
 *              only; the orchestrator stays the sole cross-machine mediator.
 *   - ADR-029  Deep-link scope resolution at the HTTP edge.
 *   - ADR-035  Failure-simulation gate composition.
 *   - ADR-040  FlowStrategy port + the `mountUniformFlowRoutes` substrate.
 */

import { KNOB, shouldInject } from "@dashboard-chat/shared-failure-simulation";
import { Hono } from "hono";

import { resolveActiveScope } from "../../active-scope.ts";
import {
  cryptoRandomId,
  mountUniformFlowRoutes,
  resultToJson,
} from "../../hexagonal-transport/flow-router.ts";
import type { FlowOrchestrator } from "../../orchestrator.ts";
import { derivePrincipalId } from "./strategy.ts";

export function buildLoginAndOrgSetupRouter(
  orchestrator: FlowOrchestrator,
  wireName: string,
): Hono {
  const router = new Hono();

  router.post("/begin", async (c) => {
    const correlationId =
      c.req.header("X-Correlation-Id") ?? cryptoRandomId();
    let body: {
      persona_email?: string;
      persona_display_name?: string;
      existing_org_names?: string[];
      force_reissue_failures?: number;
      principal_id?: string;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }

    if (!body.persona_email) {
      return c.json({ error: "persona_email required" }, 400);
    }

    // Identity channels (highest priority first): auth-proxy header,
    // body field, then a deterministic derivation from persona_email.
    const userId =
      c.req.header("X-User-Id") ||
      body.principal_id ||
      derivePrincipalId(body.persona_email);

    // force-reissue-failures gate. The orchestrator keeps its own
    // NWAVE_HARNESS_KNOBS check as defense in depth during the env-var
    // overlap window.
    const reissueFailuresAllowed = shouldInject(KNOB.forceReissueFailures, {
      body: body as Record<string, unknown>,
      correlationId,
      serviceName: "ui-state",
    });
    const result = await orchestrator.begin({
      machine: wireName,
      principal_id: userId,
      persona_email: body.persona_email ?? "",
      persona_display_name: body.persona_display_name ?? "",
      correlation_id: correlationId,
      existing_org_names: body.existing_org_names,
      force_reissue_failures: reissueFailuresAllowed
        ? body.force_reissue_failures
        : undefined,
    });
    return resultToJson(c, result, "begin_failed");
  });

  router.post("/event", async (c) => {
    const correlationId =
      c.req.header("X-Correlation-Id") ?? cryptoRandomId();
    let body: {
      flow_id?: string;
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

    // __force_failure__ — drives login into error_recoverable with the
    // supplied cause tag. Production must refuse this so a malicious
    // caller cannot bypass real auth-flow logic; the gate is
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

    // __expire_token__ — drives ready → expired_token to exercise
    // silent re-auth. Same closed-by-default gate as __force_failure__.
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

    const result = await orchestrator.send({
      machine: wireName,
      flow_id: body.flow_id,
      type: body.type,
      payload: body.payload ?? {},
      correlation_id: correlationId,
    });
    return resultToJson(c, result, "event_failed");
  });

  // Deep-link / scope-resolution endpoint. The HTTP layer is the
  // canonical place where route params meet the JWT; resolveActiveScope
  // runs here and the resulting scope is appended to the flow's event
  // log so subsequent projection reads observe the same authoritative
  // scope. Login uses the legacy route-shaped body only.
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

    // auth-proxy injects identity headers; in dev X-Org-Id is
    // dev-org-001, in prod it's the verified JWT's org_id claim.
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
      // Cross-tenant URL → surface the named diagnostic via a
      // scope_access_denied event. The projection's `state` flips to
      // `access_denied` and `scope_resolution_error.reason` names the
      // cause.
      const result = await orchestrator.appendDeepLinkEvents({
        machine: wireName,
        flow_id: body.flow_id,
        correlation_id: correlationId,
        events: [
          {
            type: "scope_access_denied",
            payload: { reason: "cross-tenant access" },
          },
        ],
      });
      return resultToJson(c, result, "open_deep_link_failed");
    }

    // Successful resolution → deep_link_opened. On reconciled
    // resolution, payload carries reconciled=true so the reducer
    // surfaces scope_reconciled in the projection.
    const result = await orchestrator.appendDeepLinkEvents({
      machine: wireName,
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
    return resultToJson(c, result, "open_deep_link_failed");
  });

  mountUniformFlowRoutes(router, orchestrator);

  return router;
}
