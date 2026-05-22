import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";

import { type Config, loadConfig } from "./config.ts";
import { resolveActiveScope } from "./lib/active-scope.ts";
import { resultToJson } from "./lib/hexagonal-transport/flow-router.ts";
import {
  createForcedFailureOrgAndReissueActor,
  createOrgAndReissueActor,
  createOrgFn,
  reissueOrgJwtFn,
} from "./lib/machines/session-onboarding/index.ts";
import {
  type BuildLoginDeps,
  buildSessionOnboardingRouter,
  type SessionOnboardingRouterContext,
} from "./lib/machines/session-onboarding/router.ts";
import {
  BeginFlowOrchestrator,
  FlowActorRegistry,
  FlowOrchestrator,
} from "./lib/orchestrator.ts";
import { type FlowEventLog, selectFlowEventLog } from "./lib/persistence/redis.ts";

export type { BuildLoginDeps } from "./lib/machines/session-onboarding/router.ts";

/**
 * Mint a reference code — the support-facing trace handle a flow surfaces to
 * the user. Honored from the X-Correlation-Id ingress header when present,
 * generated otherwise.
 */
function generateReferenceCode(): string {
  return crypto.randomUUID();
}

/**
 * Best-effort JSON body deserialization for the boundary middleware. Returns
 * undefined for body-less requests (GET/HEAD) and for malformed JSON — inner
 * handlers validate the parsed value and surface their own 400.
 */
async function readJsonBody(c: Context): Promise<unknown> {
  if (c.req.method === "GET" || c.req.method === "HEAD") return undefined;
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/**
 * Extract the forwarded Bearer token from the Authorization header (L4).
 * auth-proxy forwards the verified Bearer; ui-state re-verifies it. Empty
 * string when absent (the re-verify call then fails -> session_rejected).
 */
function readBearerToken(c: Context): string {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? "";
}

/**
 * Compose the `/flow/session-onboarding` router into a fresh Hono app.
 *
 * This is the composition seam: the production entry point calls it with
 * config-derived deps + the selected event-log; the in-process tests call it
 * with stubbed deps + a noop event-log. A single shared `FlowActorRegistry`
 * backs BOTH the `BeginFlowOrchestrator` (drives `/begin`) and the
 * `FlowOrchestrator` (drives `/event`, `/freeze`, `/thaw`, `/projection`), so
 * an actor begun via `/begin` is reachable by subsequent `/event` posts.
 */
export function buildSessionOnboardingApp(opts: {
  eventLog: FlowEventLog;
  buildLoginDeps: BuildLoginDeps;
  logTransition?: (record: Record<string, unknown>) => void;
  /** Env config threaded into the machine input so the `getWorkOSUserInfo`
   *  re-verify resolver reads its `workosUrl` from input (not a closure).
   *  Optional — the in-process tests stub `workosUserInfo` and pass none. */
  config?: Config | null;
}): Hono {
  const { eventLog, buildLoginDeps } = opts;
  const logTransition =
    opts.logTransition ??
    ((record: Record<string, unknown>): void => {
      process.stdout.write(
        `${JSON.stringify({ event: "flow.transition", ...record })}\n`,
      );
    });

  const registry = new FlowActorRegistry();
  const flowOrchestrator = new FlowOrchestrator(
    { eventLog, log: (r) => logTransition(r) },
    registry,
  );
  const beginOrchestrator = new BeginFlowOrchestrator(eventLog, registry);

  const router = new Hono<SessionOnboardingRouterContext>();
  router.use("*", async (c, next) => {
    c.set(
      "referenceCode",
      c.req.header("X-Correlation-Id") ?? generateReferenceCode(),
    );
    c.set("userId", c.req.header("X-User-Id") ?? "");
    c.set("bearerToken", readBearerToken(c));
    // The verified org claim auth-proxy injects (FIX D1). Empty string when
    // absent → "no org" (new user) downstream.
    c.set("orgId", c.req.header("X-Org-Id") ?? "");
    c.set("body", await readJsonBody(c));
    await next();
  });

  buildSessionOnboardingRouter(
    router,
    beginOrchestrator,
    flowOrchestrator,
    resolveActiveScope,
    buildLoginDeps,
    eventLog,
    logTransition,
    resultToJson,
    opts.config ?? null,
  );

  const app = new Hono();
  app.route("/flow/session-onboarding", router);
  // LEAF-2 alias (transport half): the legacy `/flow/login-and-org-setup/*`
  // path is still hit by the FE + auth-proxy + acceptance harness (all OUT of
  // this feature's scope). Mount the same router under it so those paths do
  // NOT 404 during the migration window. NOTE: the begin strategy keys flow_ids
  // by the canonical `session-onboarding:<principal>` regardless of which path
  // was used; the registry alias canonicalizes the legacy `machine` name on
  // `/event`. Callers that read the projection by the legacy
  // `login-and-org-setup:<principal>` flow_id are reconciled when the FE/harness
  // ripple lands (LEAF-6 alias removal) — out of this feature's scope.
  app.route("/flow/login-and-org-setup", router);
  return app;
}

/**
 * Production entry point: validate the environment (`loadConfig` throws at
 * startup if a required var is missing) and build the app with real
 * config-derived deps. The forced-failure harness knob (already gated at the
 * router edge) swaps in a failure-injecting `createOrgAndReissue`.
 */
function buildProductionApp(): Hono {
  const config = loadConfig();
  const eventLog = selectFlowEventLog(config.redisUrl);
  const buildLoginDeps: BuildLoginDeps = ({ forceReissueFailures }) => ({
    // workosUserInfo is NOT injected here — the machine defaults to the real
    // `getWorkOSUserInfo` resolver, which reads its workosUrl from the input
    // (config threaded below). Only the org-create actor needs config-closure.
    createOrgAndReissue:
      forceReissueFailures && forceReissueFailures > 0
        ? createForcedFailureOrgAndReissueActor(
            createOrgFn(config),
            reissueOrgJwtFn(config),
            forceReissueFailures,
          )
        : createOrgAndReissueActor(config),
  });
  return buildSessionOnboardingApp({ eventLog, buildLoginDeps, config });
}

const app =
  process.env.UI_STATE_AUTOSTART === "false" ? new Hono() : buildProductionApp();

if (process.env.UI_STATE_AUTOSTART !== "false") {
  serve({ fetch: app.fetch, port: parseInt(process.env.PORT ?? "8788", 10) });
}

export { app };
