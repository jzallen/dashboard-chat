// Flow-State Tier — Hono server entry point.
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
// In dev mode the flow-state tier calls the backend directly (compose-network
// hostname `api:8000`). The backend's middleware trusts the identity headers
// we inject. In production this routes through auth-proxy with a real bearer.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://api:8000";

// Identity that the flow-state tier presents to the backend when it acts on
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

if (process.env.FLOW_STATE_AUTOSTART !== "false") {
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
