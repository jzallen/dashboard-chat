// Session-chat HTTP transport — per-machine flow router (ADR-040
// §D4/§D5 / LEAF-2). Co-located with the machine it owns.
//
// session-chat is spawned by the orchestrator's `project_ready` broadcast
// hook on project-context `project_selected` (DWD-13 §3.2.B); a direct
// /begin POST here is idempotent and routes through beginIfNotStarted so
// the dev compose stack can exercise it without going through the J-001
// auth flow. session-chat / login-and-org-setup are NOT a true alias pair
// — canonical == legacy segment per ADR-040 §D5; this router mounts once
// at /flow/session-chat.
//
// Routes owned here:
//   POST /begin            — beginIfNotStarted via auth-proxy headers.
//   POST /event            — first_message_sent force-failure knob
//                            + session_clicked slow-resume knob (US-210).
//   POST /open-deep-link   — legacy route-shaped ScopeResolver path (the
//                            J-002 intent-shape branch lives on
//                            project-context).
//
// The strategy-agnostic routes (/freeze, /thaw, /projection,
// /projection/stream) are mounted by the shared substrate. Knob state
// lives here for the same reason it lives on project-context — the actor
// reader closures (`forceCreateSessionFailureFlag`, `slowResumeMsFlag`)
// are imported by the composition root and threaded into the session-chat
// machine deps; the /event handler mutates the flags.

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

// J-002 MR-3 harness knob: the next `first_message_sent` event whose
// request bears `X-Force-Create-Session-Failure: transient` makes the
// `createSessionEagerly` actor throw a transient error before any backend
// call. Used by the US-206 transient-failure acceptance scenario (mirrors
// project-context's create-project boundary).
let forceCreateSessionFailureNext = false;
export function forceCreateSessionFailureFlag(): boolean {
  if (forceCreateSessionFailureNext) {
    forceCreateSessionFailureNext = false;
    return true;
  }
  return false;
}

// US-210 test-infra knob (consume-once, gated). The next session-chat
// `session_clicked` whose request bears `X-Force-Slow-Resume: <ms>` holds
// the `resumeSession` invoke for <ms> before the backend round-trip, so
// the acceptance scenario can broadcast FREEZE deterministically while the
// machine is still in `resuming_session` (US-210 scenario 1). Not a
// product behavior — gated by the failure-simulation registry.
let forceSlowResumeMsNext = 0;
export function slowResumeMsFlag(): number {
  const v = forceSlowResumeMsNext;
  forceSlowResumeMsNext = 0;
  return v;
}

/**
 * Build the `/flow/session-chat` sub-router. The orchestrator owns the
 * cross-machine spawn entry (project-context `project_selected` →
 * `project_ready` hook); direct /begin POSTs here go through
 * beginIfNotStarted so dev / acceptance runs can drive session-chat
 * without traversing the J-001 auth flow first.
 */
export function buildSessionChatRouter(
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

    const principal_id =
      c.req.header("X-User-Id") || body.principal_id || "anon";
    const orgId = c.req.header("X-Org-Id") ?? "";
    const userEmail = c.req.header("X-User-Email") ?? "";
    const firstName =
      (body.persona_display_name ?? "").split(/\s+/)[0] ||
      (userEmail ? userEmail.split("@")[0] : "") ||
      "";
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

    // J-002 force-create-session-failure knob — header transport. The
    // X-Force-Create-Session-Failure wire header is unchanged; the gate
    // consultation routes through the shared failure-simulation registry
    // per ADR-035 / ADR-038. Matches the create-project pattern in
    // project-context — gated, consumed once by the actor's per-invoke check.
    if (
      body.type === "first_message_sent" &&
      shouldInject(KNOB.forceCreateSessionFailure, {
        headers: c.req.raw.headers,
        correlationId: request_id,
        serviceName: "ui-state",
      })
    ) {
      forceCreateSessionFailureNext = true;
    }

    // US-210 slow-resume knob — header transport (X-Force-Slow-Resume:
    // <ms>). Gated via the same KNOB.expireToken freeze/expiry test family.
    // Lets the scenario-1 acceptance test broadcast FREEZE while
    // resuming_session is still in flight (the in-flight 401-discard
    // contract). Consumed once.
    if (
      body.type === "session_clicked" &&
      c.req.header("X-Force-Slow-Resume") &&
      shouldInject(KNOB.expireToken, {
        event: { type: "__expire_token__" },
        correlationId: request_id,
        serviceName: "ui-state",
      })
    ) {
      const ms = Number.parseInt(
        c.req.header("X-Force-Slow-Resume") ?? "0",
        10,
      );
      forceSlowResumeMsNext = Number.isFinite(ms) && ms > 0 ? ms : 0;
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

  // session-chat /open-deep-link — legacy route-shaped ScopeResolver path
  // (the J-002 intent-shape branch lives on project-context). The HTTP
  // layer is the canonical place where route params meet the JWT;
  // `resolveActiveScope` is invoked here and the result is appended to the
  // flow's event log as a `deep_link_opened` (or `scope_access_denied`)
  // event so subsequent projection reads observe the same scope.
  router.post("/open-deep-link", async (c) => {
    const request_id = c.get("requestId");
    let body: {
      route?: {
        org?: string;
        project?: string;
        resource_type?: ResourceType;
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
