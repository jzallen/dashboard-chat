import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";

import { loadConfig } from "./config.ts";
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
import { selectFlowEventLog } from "./lib/persistence/redis.ts";

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

/**
 * Compose the outer `/flow/login-and-org-setup` router.
 *
 * Validates the environment once (`loadConfig` — throws at startup if a
 * required var is missing; no inline defaults) and assembles the login surface:
 *
 * - `buildLoginDeps` — per-request login machine deps. The forced-failure
 *   harness knob (already gated at the router edge) swaps in a fresh
 *   failure-injecting `createOrgAndReissue` (N failures then success);
 *   otherwise the real backend actor.
 * - `beginOrchestrator` — `/begin` runs through its own context-manager
 *   orchestrator, sharing the `FlowOrchestrator`'s actor registry so the begun
 *   actor stays reachable by `/event` and FREEZE/THAW.
 * - the `*` middleware resolves trusted ingress (the auth-proxy headers and the
 *   JSON body) into typed context vars (`referenceCode`, `userId`, `body`) once
 *   at the boundary, so inner handlers read `c.get(...)` rather than the raw
 *   request.
 *
 * `flowOrchestrator` is still a placeholder — it backs the not-yet-refactored
 * `/event`, `/open-deep-link`, and freeze/thaw/projection routes, so its actor
 * registry (which `beginOrchestrator` shares) is not live yet.
 */
function loginRouter(): Hono<LoginRouterEnv> {
  const config = loadConfig();
  const flowOrchestrator = {} as FlowOrchestrator;
  // Redis-backed when REDIS_URL is set, in-memory otherwise.
  const eventLog = selectFlowEventLog(config.redisUrl);
  const logTransition = (record: Record<string, unknown>): void => {
    process.stdout.write(
      `${JSON.stringify({ event: "flow.transition", ...record })}\n`,
    );
  };
  const buildLoginDeps: BuildLoginDeps = ({ forceReissueFailures }) => ({
    workosUserInfo: createWorkOSUserInfoActor(config),
    createOrgAndReissue:
      forceReissueFailures && forceReissueFailures > 0
        ? createForcedFailureOrgAndReissueActor(
            createOrgFn(config),
            reissueOrgJwtFn(config),
            forceReissueFailures,
          )
        : createOrgAndReissueActor(config),
  });
  const beginOrchestrator = new BeginFlowOrchestrator(
    eventLog,
    flowOrchestrator.registry,
  );
  const router = new Hono<LoginRouterEnv>();

  router.use("*", async (c, next) => {
    c.set(
      "referenceCode",
      c.req.header("X-Correlation-Id") ?? generateReferenceCode(),
    );
    c.set("userId", c.req.header("X-User-Id") ?? "");
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
