import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";

import { resolveActiveScope } from "./lib/active-scope.ts";
import {
  createForcedFailureOrgAndReissueActor,
  createOrgAndReissueActor,
  createOrgFn,
  createWorkOSUserInfoActor,
  reissueOrgJwtFn,
} from "./lib/machines/login-and-org-setup/index.ts";
import {
  buildLoginAndOrgSetupRouter,
  type BuildLoginDeps,
} from "./lib/machines/login-and-org-setup/router.ts";
import {
  BeginFlowOrchestrator,
  type FlowOrchestrator,
} from "./lib/orchestrator.ts";
import type { FlowEventLog } from "./lib/persistence/redis.ts";

// Endpoints the ui-state tier calls on behalf of a flow's principal. In dev
// these are compose-network hostnames; in production the backend call routes
// through auth-proxy with a real bearer (the fixed dev-principal headers below
// are replaced by a service-to-service M2M token).
const WORKOS_URL = process.env.FAKE_WORKOS_URL ?? "http://fake-workos:14299";
const BACKEND_URL = process.env.BACKEND_URL ?? "http://api:8000";
const DEFAULT_PRINCIPAL_HEADERS = {
  "x-user-id": "dev-user-001",
  "x-org-id": "dev-org-001",
  "x-user-email": "dev@localhost",
};

/**
 * Mint a reference code — the support-facing trace handle a flow surfaces to
 * the user. Shared by the top-level routes that begin a flow; honored from
 * the X-Correlation-Id ingress header when present, generated otherwise.
 */
function generateReferenceCode(): string {
  return crypto.randomUUID();
}

/**
 * Best-effort JSON body deserialization for the boundary middleware. Returns
 * undefined for body-less requests (GET/HEAD) and for malformed JSON — inner
 * handlers validate the parsed value (e.g. the /begin LoginRequest schema)
 * and surface their own 400. Shared by the top-level routes that take a body.
 */
async function readJsonBody(c: Context): Promise<unknown> {
  if (c.req.method === "GET" || c.req.method === "HEAD") return undefined;
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

type LoginRouterEnv = {
  Variables: {
    referenceCode: string;
    userId: string;
    body: unknown;
  };
};

function loginRouter(): Hono<LoginRouterEnv> {
  // FlowOrchestrator + eventLog + logTransition stay placeholders for now —
  // they back the not-yet-refactored /event, /open-deep-link, and
  // freeze/thaw/projection routes plus the real projection store.
  const flowOrchestrator = {} as FlowOrchestrator;
  const eventLog = {} as FlowEventLog;
  const logTransition = (_record: Record<string, unknown>): void => {};
  // Per-request login machine deps. The forced-failure harness knob (already
  // gated at the router edge) selects a fresh failure-injecting createOrgAndReissue
  // — N forced failures then success — otherwise the real backend actor.
  const buildLoginDeps: BuildLoginDeps = ({ forceReissueFailures }) => ({
    workosUserInfo: createWorkOSUserInfoActor(WORKOS_URL),
    createOrgAndReissue:
      forceReissueFailures && forceReissueFailures > 0
        ? createForcedFailureOrgAndReissueActor(
            createOrgFn(BACKEND_URL, DEFAULT_PRINCIPAL_HEADERS),
            reissueOrgJwtFn(BACKEND_URL, DEFAULT_PRINCIPAL_HEADERS),
            forceReissueFailures,
          )
        : createOrgAndReissueActor(BACKEND_URL, DEFAULT_PRINCIPAL_HEADERS),
  });
  // Begin runs through its own context-manager orchestrator, sharing the
  // FlowOrchestrator's actor registry so the begun actor is reachable by
  // /event + FREEZE/THAW (which go through `flowOrchestrator`).
  const beginOrchestrator = new BeginFlowOrchestrator(
    eventLog,
    flowOrchestrator.registry,
  );
  const router = new Hono<LoginRouterEnv>();

  // Ingress header management: read the auth-proxy headers once at the
  // outer boundary and expose them as typed context variables. Inner
  // handlers consume them via c.get() instead of touching c.req.header().
  router.use("*", async (c, next) => {
    c.set(
      "referenceCode",
      c.req.header("X-Correlation-Id") ?? generateReferenceCode(),
    );
    c.set("userId", c.req.header("X-User-Id") ?? "");
    // Deserialize the JSON body once at the boundary; inner handlers consume
    // the parsed value via c.get("body") and validate it, instead of each
    // touching the request stream.
    c.set("body", await readJsonBody(c));
    await next();
  });

  return buildLoginAndOrgSetupRouter(
    router,
    beginOrchestrator,
    flowOrchestrator,
    resolveActiveScope,
    buildLoginDeps,
    eventLog,
    logTransition,
  );
}

const app = new Hono();
app.route("/flow/login-and-org-setup", loginRouter());

if (process.env.UI_STATE_AUTOSTART !== "false") {
  serve({ fetch: app.fetch, port: parseInt(process.env.PORT ?? "8788", 10) });
}

export { app };
