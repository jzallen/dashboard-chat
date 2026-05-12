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
const orchestrator = new FlowOrchestrator({
  eventLog,
  loginMachineDeps: {
    workosUserInfo: createWorkOSUserInfoActor(WORKOS_URL),
    createOrgAndReissue: createOrgAndReissueActor(
      BACKEND_URL,
      DEFAULT_PRINCIPAL_HEADERS,
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
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }
  if (!body.persona_email) {
    return c.json({ error: "persona_email required" }, 400);
  }

  // Principal: in dev mode auth-proxy injects X-User-Id. Otherwise derive
  // from the persona email (deterministic, multi-tenant-safe per ADR-030).
  const principal_id =
    c.req.header("X-User-Id") || derivePrincipalId(body.persona_email);

  try {
    const projection = await orchestrator.begin({
      machine,
      principal_id,
      persona_email: body.persona_email,
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
