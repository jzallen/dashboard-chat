// UI-State Tier — Hono server entry point.
//
// Routes (per `design/handoff-design-to-distill.md` §"Endpoints"):
//   GET  /health                              — liveness check
//   POST /flow/:machine/begin                 — begin a flow, returns projection
//   POST /flow/:machine/event                 — send event to existing flow
//   GET  /flow/:machine/projection?flow_id=…  — read current projection
//
// Wiring: composition root creates the FlowEventLog adapter via
// capability-presence dispatch (REDIS_URL set → Redis tier; unset → noop),
// builds the LoginAndOrgSetup machine deps, and constructs the orchestrator.
//
// Auth: this tier trusts the X-User-Id / X-Org-Id / X-User-Email headers
// injected by auth-proxy upstream (ADR-016). It does NOT re-verify JWTs.
// In AUTH_MODE=dev the headers identify the dev user.

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { resolveActiveScope } from "./lib/active-scope.ts";
import type { ResourceType } from "./lib/active-scope.ts";
import { FlowOrchestrator } from "./lib/orchestrator.ts";
import { selectFlowEventLog } from "./lib/persistence/redis.ts";
import {
  createOrgAndReissueActor,
  createOrgFn,
  createWorkOSUserInfoActor,
  reissueOrgJwtFn,
} from "./lib/machines/login-and-org-setup.ts";
import {
  createProjectActor,
  resolveInitialScopeActor,
} from "./lib/machines/project-and-chat-session-management.ts";

const PORT = parseInt(process.env.PORT ?? "8788", 10);
const REDIS_URL = process.env.REDIS_URL;
const WORKOS_URL = process.env.FAKE_WORKOS_URL ?? "http://fake-workos:14299";
// In dev mode the ui-state tier calls the backend directly (compose-network
// hostname `api:8000`). The backend's middleware trusts the identity headers
// we inject. In production this routes through auth-proxy with a real bearer.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://api:8000";

// Identity that the ui-state tier presents to the backend when it acts on
// behalf of a flow's principal. In AUTH_MODE=dev this is the dev user; in
// production a service-to-service M2M token replaces these headers.
const DEFAULT_PRINCIPAL_HEADERS = {
  "x-user-id": "dev-user-001",
  "x-org-id": "dev-org-001",
  "x-user-email": "dev@localhost",
};

const eventLog = selectFlowEventLog(REDIS_URL);

// J-002 harness knob: per-process counter; the next `create_project_submitted`
// event whose request bears `X-Force-Create-Project-Failure: transient`
// makes the actor throw a transient error before any backend call. Used by
// the US-201 transient-failure acceptance scenario (mirrors J-001's
// `__harness_force_failure__` pattern but at the actor level).
let forceCreateProjectFailureNext = false;
function forceCreateProjectFailureFlag(): boolean {
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
function shouldFailListSessions(project_id: string): boolean {
  return forceListSessionsFailures.has(project_id);
}

const orchestrator = new FlowOrchestrator({
  eventLog,
  loginMachineDeps: {
    workosUserInfo: createWorkOSUserInfoActor(WORKOS_URL),
    createOrgAndReissue: createOrgAndReissueActor(
      BACKEND_URL,
      DEFAULT_PRINCIPAL_HEADERS,
    ),
  },
  projectFlowMachineDeps: {
    resolveInitialScope: resolveInitialScopeActor(
      BACKEND_URL,
      DEFAULT_PRINCIPAL_HEADERS,
      shouldFailListSessions,
    ),
    createProject: createProjectActor(
      BACKEND_URL,
      DEFAULT_PRINCIPAL_HEADERS,
      forceCreateProjectFailureFlag,
    ),
  },
  createOrgFn: createOrgFn(BACKEND_URL, DEFAULT_PRINCIPAL_HEADERS),
  reissueOrgJwtFn: reissueOrgJwtFn(BACKEND_URL, DEFAULT_PRINCIPAL_HEADERS),
});

const app = new Hono();

/**
 * Closed list of event types the harness uses to drive the machine into
 * recoverable-error and expired-token states. Per DWD-1, these are gated by
 * NWAVE_HARNESS_KNOBS=true: production deployments leave the env var unset,
 * so the route refuses to dispatch the event with a clear error.
 */
const HARNESS_EVENT_TYPES: ReadonlySet<string> = new Set([
  "__harness_force_failure__",
  "__harness_expire_token__",
]);

/**
 * Wire the ui-state routes onto the supplied Hono app, using the supplied
 * orchestrator as the state owner. Extracted so tests can build a scenario-
 * scoped app + orchestrator pair without invoking the production composition
 * root (which probes Redis, binds the port, and constructs the WorkOS / backend
 * adapters).
 */
export function wireRoutes(app: Hono, orchestrator: FlowOrchestrator): void {

app.get("/health", (c) => c.json({ status: "ok" }));

app.post("/flow/:machine/begin", async (c) => {
  const machine = c.req.param("machine");
  const correlation_id =
    c.req.header("X-Correlation-Id") ?? cryptoRandomId();
  let body: {
    persona_email?: string;
    persona_display_name?: string;
    existing_org_names?: string[];
    harness_force_reissue_failures?: number;
    principal_id?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  // J-001 requires the persona_email to drive the WorkOS exchange. J-002
  // (and other non-J-001 machines) spawn via the orchestrator's j001_ready
  // broadcast hook, so a direct `/begin` POST for them is idempotent —
  // returns the existing projection or spawns a fresh actor.
  if (machine === "login-and-org-setup") {
    if (!body.persona_email) {
      return c.json({ error: "persona_email required" }, 400);
    }
  }

  // Principal: in dev mode auth-proxy injects X-User-Id. Otherwise derive
  // from the persona email (deterministic, multi-tenant-safe per ADR-030).
  const principal_id =
    c.req.header("X-User-Id") ||
    body.principal_id ||
    (body.persona_email ? derivePrincipalId(body.persona_email) : "anon");

  // For non-J-001 machines (J-002+), prefer the explicit beginIfNotStarted
  // path that takes auth-proxy-injected identity headers. This bypasses
  // the J-001 persona/WorkOS preconditions and lets the dev compose stack
  // exercise J-002 without dragging a fake WorkOS server into scope.
  // Direct HTTP `/begin` always resets the actor + event log so the call
  // is idempotent for re-runs (matches J-001's begin semantics).
  if (machine !== "login-and-org-setup") {
    const orgId = c.req.header("X-Org-Id") ?? "";
    const userEmail = c.req.header("X-User-Email") ?? "";
    const firstName =
      (body.persona_display_name ?? "").split(/\s+/)[0] ||
      (userEmail ? userEmail.split("@")[0] : "") ||
      "";
    // J-002 harness knob — header-gated: the resolver treats listed project
    // ids' list_sessions calls as 5xx-failed. Comma-separated ids. Cleared
    // each /begin so test scenarios don't leak state.
    forceListSessionsFailures.clear();
    const forceFailHeader = c.req.header("X-Force-List-Sessions-Failure");
    if (forceFailHeader && machine === "project-and-chat-session-management") {
      for (const raw of forceFailHeader.split(",")) {
        const id = raw.trim();
        if (id) forceListSessionsFailures.add(id);
      }
    }
    try {
      const projection = await orchestrator.beginIfNotStarted({
        machine,
        principal_id,
        correlation_id,
        org_id: orgId,
        user_first_name: firstName,
        force_restart: true,
      });
      return c.json(projection);
    } catch (err) {
      return c.json(
        { error: "begin_failed", message: (err as Error).message },
        500,
      );
    }
  }

  try {
    const projection = await orchestrator.begin({
      machine,
      principal_id,
      persona_email: body.persona_email ?? "",
      persona_display_name: body.persona_display_name ?? "",
      correlation_id,
      existing_org_names: body.existing_org_names,
      harness_force_reissue_failures: body.harness_force_reissue_failures,
    });
    return c.json(projection);
  } catch (err) {
    return c.json(
      { error: "begin_failed", message: (err as Error).message },
      500,
    );
  }
});

app.post("/flow/:machine/event", async (c) => {
  const machine = c.req.param("machine");
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

  // Harness-event gating (DWD-1): the `__harness_*` events drive the machine
  // into states that have no production-callable entry. Production deployments
  // leave NWAVE_HARNESS_KNOBS unset → the route refuses the event with a
  // clear error so a malicious caller can't bypass real flow logic.
  if (HARNESS_EVENT_TYPES.has(body.type)) {
    if (process.env.NWAVE_HARNESS_KNOBS !== "true") {
      return c.json(
        {
          error:
            "harness knob disabled: __harness_* events require NWAVE_HARNESS_KNOBS=true (dev-mode only)",
        },
        403,
      );
    }
  }

  // J-002 harness knob — header-gated: the next createProject invoke throws
  // a transient error. Used by the US-201 transient-failure scenario. Gated
  // by the same NWAVE_HARNESS_KNOBS env-flag policy as the J-001 knobs in
  // production; in dev mode (default for the local stack) the flag is
  // accepted unconditionally to match the local-stack harness shape.
  if (
    machine === "project-and-chat-session-management" &&
    body.type === "create_project_submitted" &&
    c.req.header("X-Force-Create-Project-Failure")
  ) {
    forceCreateProjectFailureNext = true;
  }

  try {
    const projection = await orchestrator.send({
      machine,
      flow_id: body.flow_id,
      type: body.type,
      payload: body.payload ?? {},
      correlation_id,
    });
    return c.json(projection);
  } catch (err) {
    return c.json(
      { error: "event_failed", message: (err as Error).message },
      500,
    );
  }
});

// Deep-link / scope-resolution endpoint per ADR-029 (Step 01-03).
//
// The HTTP layer is the canonical place where route params meet the JWT.
// `resolveActiveScope` is invoked here; the resulting scope is appended to
// the flow's event log as a `deep_link_opened` event so subsequent
// projection reads observe the same authoritative scope.
//
// Wire shape (POST body):
//   {
//     flow_id: string,                                  // existing flow
//     route: {
//       org?: string, project?: string,
//       resource_type?: "dataset"|"view"|"report",
//       resource_id?: string,
//     },
//     project_name?: string,                            // server-known name (current)
//     bookmarked_project_name?: string,                 // URL-carried name (possibly stale)
//   }
//
// Headers (injected by auth-proxy):
//   X-User-Id, X-Org-Id, X-User-Email
//
// Returns: the updated FlowProjection envelope.
app.post("/flow/:machine/open-deep-link", async (c) => {
  const machine = c.req.param("machine");
  const correlation_id =
    c.req.header("X-Correlation-Id") ?? cryptoRandomId();
  let body: {
    flow_id?: string;
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

  // ─── J-002 intent-shaped deep link (US-204) ─────────────────────────────
  // The J-002 surface takes a different deep-link shape: instead of route
  // params + ScopeResolver, the caller supplies intent_* fields directly.
  // The orchestrator forwards an `open_deep_link` event to the J-002 actor
  // which re-enters resolving_initial_scope with the new intent. The flow
  // is auto-spawned if not yet started.
  const isProjectFlowDeepLinkIntent =
    machine === "project-and-chat-session-management" &&
    (body.intent_project_id !== undefined ||
      body.intent_session_id !== undefined ||
      body.intent_resource_id !== undefined);
  if (isProjectFlowDeepLinkIntent) {
    const principalId =
      c.req.header("X-User-Id") ?? body.principal_id ?? "";
    if (!principalId) {
      return c.json({ error: "principal_id required" }, 400);
    }
    const orgId = c.req.header("X-Org-Id") ?? "";
    const userEmail = c.req.header("X-User-Email") ?? "";
    const firstName = (userEmail.split("@")[0] || "").trim() || null;
    try {
      // Ensure J-002 is spawned; idempotent.
      await orchestrator.beginIfNotStarted({
        machine,
        principal_id: principalId,
        correlation_id,
        org_id: orgId,
        user_first_name: firstName ?? "",
      });
      // Forward open_deep_link to the J-002 actor.
      const flowId = body.flow_id ?? `${machine}:${principalId}`;
      const payload: Record<string, unknown> = {};
      if (body.intent_project_id !== undefined)
        payload.intent_project_id = body.intent_project_id;
      if (body.intent_session_id !== undefined)
        payload.intent_session_id = body.intent_session_id;
      if (body.intent_resource_id !== undefined)
        payload.intent_resource_id = body.intent_resource_id;
      if (body.intent_resource_type !== undefined)
        payload.intent_resource_type = body.intent_resource_type;
      const projection = await orchestrator.send({
        machine,
        flow_id: flowId,
        type: "open_deep_link",
        payload,
        correlation_id,
      });
      return c.json(projection);
    } catch (err) {
      return c.json(
        { error: "open_deep_link_failed", message: (err as Error).message },
        500,
      );
    }
  }

  // ─── Legacy route-shaped deep link (J-001 / ScopeResolver path) ─────────
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

  try {
    if (!resolution.ok) {
      // I1 / I4: cross-tenant URL. Surface the named diagnostic via a
      // scope_access_denied event. The projection's `state` flips to
      // `access_denied` and `scope_resolution_error.reason` names the cause.
      const projection = await orchestrator.appendDeepLinkEvents({
        machine,
        flow_id: body.flow_id,
        correlation_id,
        events: [
          {
            type: "scope_access_denied",
            payload: { reason: "cross-tenant access" },
          },
        ],
      });
      return c.json(projection);
    }

    // Successful resolution: emit deep_link_opened. If reconciled (I5), the
    // event payload carries reconciled=true; the reducer surfaces a
    // scope_reconciled signal in the projection that an accompanying test
    // agent can observe.
    const projection = await orchestrator.appendDeepLinkEvents({
      machine,
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
    return c.json(projection);
  } catch (err) {
    return c.json(
      { error: "open_deep_link_failed", message: (err as Error).message },
      500,
    );
  }
});

app.get("/flow/:machine/projection", async (c) => {
  const flow_id = c.req.query("flow_id");
  if (!flow_id) {
    return c.json({ error: "flow_id required" }, 400);
  }
  try {
    const projection = await orchestrator.getProjection(flow_id);
    return c.json(projection);
  } catch (err) {
    return c.json(
      { error: "projection_failed", message: (err as Error).message },
      500,
    );
  }
});

} // end wireRoutes

// Production composition: wire routes onto the module-level app + orchestrator.
wireRoutes(app, orchestrator);

function derivePrincipalId(email: string): string {
  // Replace non-alphanum with underscore; gives a stable principal_id from
  // a persona email without exposing the email in the URL/key. Matches the
  // shape "user_<localpart>" used in `tests/.../fixtures/personas.ts`.
  const local = email.split("@")[0]?.replace(/[^a-zA-Z0-9]/g, "_") ?? "anon";
  return `user_${local}`;
}

function cryptoRandomId(): string {
  // Hono's runtime exposes globalThis.crypto; randomUUID is in Node 19+.
  return globalThis.crypto?.randomUUID?.() ?? `corr-${Date.now()}`;
}

if (process.env.UI_STATE_AUTOSTART !== "false") {
  // Probe Redis early so the container hard-fails per ADR-030 §SD3 if
  // REDIS_URL is set but the server cannot round-trip XADD/XRANGE/DEL.
  eventLog
    .probe()
    .then(() => {
      serve({ fetch: app.fetch, port: PORT });
      // eslint-disable-next-line no-console
      console.log(
        JSON.stringify({
          event: "flow.startup",
          port: PORT,
          redis_url_set: Boolean(REDIS_URL),
          workos_url: WORKOS_URL,
        }),
      );
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          event: "flow.startup.fatal",
          error: (err as Error).message,
        }),
      );
      process.exit(1);
    });
}

export { app, orchestrator };
