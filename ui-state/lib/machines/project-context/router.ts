// Project-context HTTP transport — per-machine flow router (ADR-040
// §D4/§D5 / LEAF-2). Co-located with the machine it owns.
//
// The project-context machine wears the J-002 wire name
// `project-and-chat-session-management` (the established Redis event-log
// key prefix + projection `flow_id` segment); the FE-facing FlowProjection
// resolves through TWO mount paths against the SAME router instance:
//
//   /flow/project-context                         — canonical (ADR-039)
//   /flow/project-and-chat-session-management     — legacy feature-slug
//
// The dual mount is registered by the caller (`ui-state/index.ts`); this
// module just produces one router and forwards `wireName` to the
// orchestrator (kept at the established name so flow_id / Redis bytes /
// projection envelopes stay identical through the migration — LEAF-6
// flips this once the FE migrates).
//
// Routes owned here:
//   POST /begin            — beginIfNotStarted via auth-proxy headers
//                            + force-list-sessions knob.
//   POST /event            — create_project_submitted force-failure knob
//                            + switching_project_intent slow-switch knob.
//   POST /open-deep-link   — J-002 intent-shaped branch (US-204 / DWD-9)
//                            + legacy route-shaped ScopeResolver fallback.
//
// The strategy-agnostic routes (/freeze, /thaw, /projection,
// /projection/stream) are mounted by the shared substrate.
//
// Knob state lives here because it is machine-scoped: the actor reader
// closures (`forceCreateProjectFailureFlag`, `shouldFailListSessions`,
// `slowSwitchMsFlag`) are imported by the composition root in
// `ui-state/index.ts` and threaded into the project-context machine deps.
// The /event handler MUTATES the flags; the actors READ them. Keeping
// both halves co-located with the machine surfaces the coupling instead
// of stranding it module-globally in `index.ts`.

import { KNOB, shouldInject } from "@dashboard-chat/shared-failure-simulation";
import { Hono } from "hono";

import { resolveActiveScope, type ResourceType } from "../../active-scope.ts";
import { FlowId } from "../../flow-id.ts";
import {
  mountUniformFlowRoutes,
  requestIdMiddleware,
  resultToJson,
} from "../../hexagonal-transport/flow-router.ts";
import type { FlowOrchestrator } from "../../orchestrator.ts";
import { FlowEvent } from "../../projection.ts";

// J-002 harness knob: per-process counter; the next `create_project_submitted`
// event whose request bears `X-Force-Create-Project-Failure: transient`
// makes the actor throw a transient error before any backend call. Used by
// the US-201 transient-failure acceptance scenario (mirrors J-001's
// `__force_failure__` pattern but at the actor level).
let forceCreateProjectFailureNext = false;
export function forceCreateProjectFailureFlag(): boolean {
  if (forceCreateProjectFailureNext) {
    forceCreateProjectFailureNext = false;
    return true;
  }
  return false;
}

// J-002 harness knob: header-gated set of project ids whose list_sessions
// the resolver should treat as 5xx-failed. Used by the US-202 degraded path
// scenario (`X-Force-List-Sessions-Failure: <id>[, <id>]`). Consumed once
// per `/begin` call — cleared after the resolver has run.
const forceListSessionsFailures = new Set<string>();
export function shouldFailListSessions(project_id: string): boolean {
  return forceListSessionsFailures.has(project_id);
}

// US-210 test-infra knob (consume-once, gated) — project-context analog
// of session-chat's slowResumeMsFlag. The next switching_project_intent
// bearing X-Force-Slow-Switch-Project: <ms> holds the switchProject invoke
// so the scenario-2 acceptance test can broadcast FREEZE while the machine
// is still in `switching_project`. Not a product behavior.
let forceSlowSwitchMsNext = 0;
export function slowSwitchMsFlag(): number {
  const v = forceSlowSwitchMsNext;
  forceSlowSwitchMsNext = 0;
  return v;
}

/**
 * Build the `/flow/project-context` + legacy-alias sub-router. The caller
 * mounts the resulting Hono instance at BOTH paths (ADR-040 §D5) so the
 * ADR-027 §1 FE projection contract holds through the migration with no
 * 404 window. `wireName` is forwarded to the orchestrator as the strategy
 * key — passed in as the established legacy segment
 * (`project-and-chat-session-management`) so flow_id / Redis bytes /
 * projection envelopes stay byte-identical to the pre-LEAF-2 baseline.
 */
export function buildProjectContextRouter(
  orchestrator: FlowOrchestrator,
  wireName: string,
): Hono {
  const router = new Hono();
  // Centralized request-id minting — honor an inbound X-Request-Id, mint
  // otherwise. One registration replaces the per-handler inline mint sites;
  // handlers read the id via c.get("requestId").
  router.use("*", requestIdMiddleware);

  router.post("/begin", async (c) => {
    const request_id = c.get("requestId");
    let body: {
      persona_display_name?: string;
      principal_id?: string;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }

    // J-002 spawn via the orchestrator's auth_ready broadcast hook is the
    // production path; a direct `/begin` POST is idempotent — returns the
    // existing projection or spawns a fresh actor with the auth-proxy-
    // injected identity headers. Bypasses the J-001 persona/WorkOS
    // preconditions and lets the dev compose stack exercise J-002 without
    // dragging a fake WorkOS server into scope. Always resets the actor +
    // event log so the call is idempotent for re-runs.
    const principal_id =
      c.req.header("X-User-Id") || body.principal_id || "anon";
    const orgId = c.req.header("X-Org-Id") ?? "";
    const userEmail = c.req.header("X-User-Email") ?? "";
    const firstName =
      (body.persona_display_name ?? "").split(/\s+/)[0] ||
      (userEmail ? userEmail.split("@")[0] : "") ||
      "";
    // J-002 force-list-sessions-failure knob — header transport. The
    // X-Force-List-Sessions-Failure wire value (comma-separated project ids)
    // is unchanged; the gate consultation routes through the shared
    // failure-simulation registry so the verdict honors the ADR-035 gate and
    // the audit envelope captures the header value. Cleared each /begin so
    // test scenarios don't leak state.
    forceListSessionsFailures.clear();
    if (
      shouldInject(KNOB.forceListSessionsFailure, {
        headers: c.req.raw.headers,
        correlationId: request_id,
        serviceName: "ui-state",
      })
    ) {
      const forceFailHeader =
        c.req.header("X-Force-List-Sessions-Failure") ?? "";
      for (const raw of forceFailHeader.split(",")) {
        const id = raw.trim();
        if (id) forceListSessionsFailures.add(id);
      }
    }
    const result = await orchestrator.beginIfNotStarted({
      flowId: FlowId.of(wireName, principal_id),
      request_id,
      org_id: orgId,
      user_first_name: firstName,
      force_restart: true,
    });
    return resultToJson(c, result, "begin_failed");
  });

  router.post("/event", async (c) => {
    const request_id = c.get("requestId");
    let body: {
      type?: string;
      payload?: Record<string, unknown>;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    if (!body.type) {
      return c.json({ error: "type required" }, 400);
    }
    // The flow is addressed by this route's machine + the verified principal
    // (ADR-040), never accepted from the body.
    const flowId = FlowId.of(wireName, c.req.header("X-User-Id") ?? "");

    // J-002 force-create-project-failure knob — header transport. The wire
    // signal (X-Force-Create-Project-Failure) is unchanged; the gate
    // consultation routes through the shared failure-simulation registry
    // (ADR-035 + ADR-038) so the verdict honors ENVIRONMENT × flag composition
    // and emits the audit envelope. The post-knob effect (consume-once flag)
    // is preserved end-to-end so the actor's per-invoke check is unchanged.
    if (
      body.type === "create_project_submitted" &&
      shouldInject(KNOB.forceCreateProjectFailure, {
        headers: c.req.raw.headers,
        correlationId: request_id,
        serviceName: "ui-state",
      })
    ) {
      forceCreateProjectFailureNext = true;
    }

    // US-210 slow-switch-project knob — header transport
    // (X-Force-Slow-Switch-Project: <ms>). Gated via the same
    // KNOB.expireToken freeze/expiry test family. Lets the scenario-2
    // acceptance test broadcast FREEZE while switching_project is still in
    // flight (the in-flight 401-discard contract). Consumed once.
    if (
      body.type === "switching_project_intent" &&
      c.req.header("X-Force-Slow-Switch-Project") &&
      shouldInject(KNOB.expireToken, {
        event: { type: "__expire_token__" },
        correlationId: request_id,
        serviceName: "ui-state",
      })
    ) {
      const ms = Number.parseInt(
        c.req.header("X-Force-Slow-Switch-Project") ?? "0",
        10,
      );
      forceSlowSwitchMsNext = Number.isFinite(ms) && ms > 0 ? ms : 0;
    }

    const result = await orchestrator.send(
      FlowEvent.from(flowId, {
        type: body.type,
        payload: body.payload,
        request_id,
      }),
    );
    return resultToJson(c, result, "event_failed");
  });

  // Deep-link / scope-resolution endpoint per ADR-029 (Step 01-03).
  //
  // The HTTP layer is the canonical place where route params meet the JWT.
  // For J-002 callers the body carries `intent_*` fields and the
  // orchestrator forwards an `open_deep_link` event to the J-002 actor
  // which re-enters resolving_initial_scope with the new intent. For
  // legacy callers the body carries a `route` and `resolveActiveScope`
  // appends a `deep_link_opened` (or `scope_access_denied`) event so
  // subsequent projection reads observe the same authoritative scope.
  router.post("/open-deep-link", async (c) => {
    const request_id = c.get("requestId");
    let body: {
      principal_id?: string;
      route?: {
        org?: string;
        project?: string;
        resource_type?: ResourceType;
        resource_id?: string;
      };
      project_name?: string;
      bookmarked_project_name?: string;
      // J-002 intent-shaped payload (US-204 / DWD-9):
      intent_project_id?: string;
      intent_session_id?: string;
      intent_resource_id?: string;
      intent_resource_type?: ResourceType;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }

    // ─── J-002 intent-shaped deep link (US-204) ─────────────────────────
    // The J-002 surface takes a different deep-link shape: instead of route
    // params + ScopeResolver, the caller supplies intent_* fields directly.
    // The orchestrator forwards an `open_deep_link` event to the J-002 actor
    // which re-enters resolving_initial_scope with the new intent. The flow
    // is auto-spawned if not yet started.
    const isProjectFlowDeepLinkIntent =
      body.intent_project_id !== undefined ||
      body.intent_session_id !== undefined ||
      body.intent_resource_id !== undefined;
    if (isProjectFlowDeepLinkIntent) {
      const principalId = c.req.header("X-User-Id") ?? body.principal_id ?? "";
      if (!principalId) {
        return c.json({ error: "principal_id required" }, 400);
      }
      const orgId = c.req.header("X-Org-Id") ?? "";
      const userEmail = c.req.header("X-User-Email") ?? "";
      const firstName = (userEmail.split("@")[0] || "").trim() || null;
      // Ensure J-002 is spawned; idempotent.
      const spawn = await orchestrator.beginIfNotStarted({
        flowId: FlowId.of(wireName, principalId),
        request_id,
        org_id: orgId,
        user_first_name: firstName ?? "",
      });
      if (!spawn.ok) {
        return resultToJson(c, spawn, "open_deep_link_failed");
      }
      // Forward open_deep_link to the J-002 actor. The flow is addressed by
      // this route's machine + the verified principal (ADR-040), never accepted
      // from the body.
      const flowId = FlowId.of(wireName, principalId);
      const payload: Record<string, unknown> = {};
      if (body.intent_project_id !== undefined)
        payload.intent_project_id = body.intent_project_id;
      if (body.intent_session_id !== undefined)
        payload.intent_session_id = body.intent_session_id;
      if (body.intent_resource_id !== undefined)
        payload.intent_resource_id = body.intent_resource_id;
      if (body.intent_resource_type !== undefined)
        payload.intent_resource_type = body.intent_resource_type;
      const result = await orchestrator.send(
        FlowEvent.from(flowId, {
          type: "open_deep_link",
          payload,
          request_id,
        }),
      );
      return resultToJson(c, result, "open_deep_link_failed");
    }

    // ─── Legacy route-shaped deep link (J-001 / ScopeResolver path) ────
    // The auth-proxy injects identity headers. In dev mode X-Org-Id is
    // "dev-org-001"; in prod it's the verified JWT's org_id claim.
    const principalId = c.req.header("X-User-Id") ?? "";
    const orgId = c.req.header("X-Org-Id") ?? null;
    // flow_id is derived from the verified principal (ADR-040), never accepted
    // from the body.
    const flowId = `${wireName}:${principalId}`;

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
        flow_id: flowId,
        request_id,
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
      flow_id: flowId,
      request_id,
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

  mountUniformFlowRoutes(router, orchestrator, wireName);

  return router;
}
