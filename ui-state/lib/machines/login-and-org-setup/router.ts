// Login-and-org-setup HTTP transport — per-machine flow router (ADR-040
// §D4/§D5 / LEAF-2). Co-located with the machine it owns. The shared
// substrate at `ui-state/lib/hexagonal-transport/flow-router.ts` mounts
// the machine-agnostic routes (`/freeze`, `/thaw`, `/projection`,
// `/projection/stream`); this module owns the login-specific transport:
//
//   POST /begin            — direct WorkOS + org-create begin (the only
//                            `beginsDirectly` machine); persona_email is
//                            mandatory + `force_reissue_failures` is the
//                            slice-1 failure-simulation knob.
//   POST /event            — accepts `__force_failure__` (transient cause
//                            classification) and `__expire_token__` wire
//                            events under the same gate family.
//   POST /open-deep-link   — legacy ScopeResolver path (no J-002 intent-
//                            shaped branch — that lives on project-context).
//
// ADR-028 invariant preserved: this module imports the substrate +
// `flow-result.ts` + the orchestrator's TYPES only. The orchestrator
// stays the sole cross-machine mediator.

import { KNOB, shouldInject } from "@dashboard-chat/shared-failure-simulation";
import { Hono } from "hono";

import { resolveActiveScope } from "../../active-scope.ts";
import {
  cryptoRandomId,
  mountUniformFlowRoutes,
  resultToJson,
} from "../../hexagonal-transport/flow-router.ts";
import type { FlowOrchestrator } from "../../orchestrator.ts";

/**
 * Build the `/flow/login-and-org-setup` sub-router. `wireName` is forwarded
 * to the orchestrator as the strategy key (canonical == legacy segment for
 * login — see ADR-040 §D5 path-surface map; this machine is NOT a true
 * alias pair).
 */
export function buildLoginAndOrgSetupRouter(
  orchestrator: FlowOrchestrator,
  wireName: string,
): Hono {
  const router = new Hono();

  router.post("/begin", async (c) => {
    const correlation_id =
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

    // J-001 requires the persona_email to drive the WorkOS exchange.
    if (!body.persona_email) {
      return c.json({ error: "persona_email required" }, 400);
    }

    // Principal: in dev mode auth-proxy injects X-User-Id. Otherwise derive
    // from the persona email (deterministic, multi-tenant-safe per ADR-030).
    const principal_id =
      c.req.header("X-User-Id") ||
      body.principal_id ||
      derivePrincipalId(body.persona_email);

    // force-reissue-failures knob — body-field transport. Phase-2 vocabulary
    // cleanup per ADR-038: the wire body field is `force_reissue_failures`,
    // the legacyAlias bridge is dropped. The gate routes through the shared
    // registry so the verdict + audit envelope are uniform across all six
    // knobs. The orchestrator retains its own NWAVE_HARNESS_KNOBS check as
    // defense in depth during the one-release env-var overlap window.
    const reissueFailuresAllowed = shouldInject(KNOB.forceReissueFailures, {
      body: body as Record<string, unknown>,
      correlationId: correlation_id,
      serviceName: "ui-state",
    });
    const result = await orchestrator.begin({
      machine: wireName,
      principal_id,
      persona_email: body.persona_email ?? "",
      persona_display_name: body.persona_display_name ?? "",
      correlation_id,
      existing_org_names: body.existing_org_names,
      force_reissue_failures: reissueFailuresAllowed
        ? body.force_reissue_failures
        : undefined,
    });
    return resultToJson(c, result, "begin_failed");
  });

  router.post("/event", async (c) => {
    const correlation_id =
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

    // force-failure-on-auth-retry knob — event transport. The
    // __force_failure__ wire event drives the login-and-org-setup machine
    // into error_recoverable with the supplied cause tag (DWD-1).
    // Production deployments must refuse this event so a malicious caller
    // can't bypass real auth flow logic; the ADR-035 gate (ENVIRONMENT ×
    // flag) is the closed-by-default decision and the registry surfaces
    // a failure-simulation.rejected audit entry when the event arrives in
    // a denying tier. Wire form `__force_failure__` derives from canonical
    // via the eventDistinguisher rendering rule (ADR-038).
    if (body.type === "__force_failure__") {
      const allowed = shouldInject(KNOB.forceFailureOnAuthRetry, {
        event: { type: body.type },
        correlationId: correlation_id,
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

    // expire-token knob — event transport. The __expire_token__ wire event
    // drives the login-and-org-setup machine from `ready` into
    // `expired_token` to exercise silent re-auth (DWD-1). The gate decision
    // routes through shouldInject(KNOB.expireToken, { event, ... }) and
    // emits the ADR-037 audit envelope. Phase-2 vocabulary cleanup per
    // ADR-038 — the legacyAlias bridge is dropped and the wire event type
    // now matches the registry's canonical-derived rendering.
    if (body.type === "__expire_token__") {
      const allowed = shouldInject(KNOB.expireToken, {
        event: { type: body.type },
        correlationId: correlation_id,
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
      correlation_id,
    });
    return resultToJson(c, result, "event_failed");
  });

  // Deep-link / scope-resolution endpoint per ADR-029 (Step 01-03). Login
  // gets the legacy route-shaped body (the J-002 intent-shaped branch
  // lives on project-context only). The HTTP layer is the canonical place
  // where route params meet the JWT; `resolveActiveScope` is invoked here
  // and the resulting scope is appended to the flow's event log as a
  // `deep_link_opened` event so subsequent projection reads observe the
  // same authoritative scope.
  router.post("/open-deep-link", async (c) => {
    const correlation_id =
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

    // The auth-proxy injects identity headers. In dev mode X-Org-Id is
    // "dev-org-001"; in prod it's the verified JWT's org_id claim.
    const principalId = c.req.header("X-User-Id") ?? "";
    const orgId = c.req.header("X-Org-Id") ?? null;

    const route = body.route ?? {};
    const resolution = resolveActiveScope(
      route,
      { sub: principalId, org_id: orgId },
      {
        bookmarked_project_name: body.bookmarked_project_name ?? null,
        current_project_name: body.project_name ?? null,
      },
    );

    if (!resolution.ok) {
      // I1 / I4: cross-tenant URL. Surface the named diagnostic via a
      // scope_access_denied event. The projection's `state` flips to
      // `access_denied` and `scope_resolution_error.reason` names the cause.
      const result = await orchestrator.appendDeepLinkEvents({
        machine: wireName,
        flow_id: body.flow_id,
        correlation_id,
        events: [
          {
            type: "scope_access_denied",
            payload: { reason: "cross-tenant access" },
          },
        ],
      });
      return resultToJson(c, result, "open_deep_link_failed");
    }

    // Successful resolution: emit deep_link_opened. If reconciled (I5),
    // the event payload carries reconciled=true; the reducer surfaces a
    // scope_reconciled signal in the projection that an accompanying test
    // agent can observe.
    const result = await orchestrator.appendDeepLinkEvents({
      machine: wireName,
      flow_id: body.flow_id,
      correlation_id,
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

function derivePrincipalId(email: string): string {
  // Replace non-alphanum with underscore; gives a stable principal_id from
  // a persona email without exposing the email in the URL/key. Matches the
  // shape "user_<localpart>" used in `tests/.../fixtures/personas.ts`.
  const local = email.split("@")[0]?.replace(/[^a-zA-Z0-9]/g, "_") ?? "anon";
  return `user_${local}`;
}
