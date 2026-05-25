import { serve } from "@hono/node-server";
import { type Context, Hono } from "hono";

import { type Config, loadConfig } from "./config.ts";
import { resolveActiveScope } from "./lib/active-scope.ts";
import {
  requestIdMiddleware,
  resultToJson,
} from "./lib/hexagonal-transport/flow-router.ts";
import {
  buildSessionOnboardingRouter,
  type SessionOnboardingRouterContext,
} from "./lib/machines/session-onboarding/router.ts";
import {
  BeginFlowOrchestrator,
  FlowActorRegistry,
  FlowOrchestrator,
} from "./lib/orchestrator.ts";
import { type FlowEventLog, selectFlowEventLog } from "./lib/persistence/redis.ts";

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
 * config + the real `globalThis.fetch` (the default) + the selected event-log;
 * the in-process tests call it with placeholder config + a mock `fetch` (the
 * `requestClient` opt) + a noop event-log. A single shared `FlowActorRegistry`
 * backs BOTH the `BeginFlowOrchestrator` (drives `/begin`) and the
 * `FlowOrchestrator` (drives `/event`, `/freeze`, `/thaw`, `/projection`), so
 * an actor begun via `/begin` is reachable by subsequent `/event` posts.
 */
export function buildSessionOnboardingApp(opts: {
  eventLog: FlowEventLog;
  logTransition?: (record: Record<string, unknown>) => void;
  /** Env config threaded into the machine input so the `getWorkOSUserInfo`
   *  re-verify resolver + the `getOrgAndReissue` org-create resolver read their
   *  URLs (workosUrl/backendUrl) from input (not a closure). The in-process
   *  tests carry placeholder URLs because the injected mock `fetch` decides the
   *  responses. */
  config?: Config | null;
  /** The I/O port (the `fetch` library) the re-verify + org-create resolvers
   *  call directly, threaded into the machine input as `deps.request_client`.
   *  Defaults to `globalThis.fetch` so production needs no extra wiring; the
   *  in-process tests inject a mock `fetch`. */
  requestClient?: typeof fetch;
}): Hono {
  const { eventLog } = opts;
  const requestClient = opts.requestClient ?? globalThis.fetch;
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
  // Centralized request-id minting (research: hono-request-id-middleware.md):
  // honor an inbound X-Request-Id, mint otherwise. Registered first so the
  // boundary middleware below — and every handler — reads one consistent id
  // via c.get("requestId"). The support-facing `referenceCode` is now just
  // that id under its user-facing name.
  router.use("*", requestIdMiddleware);
  router.use("*", async (c, next) => {
    c.set("referenceCode", c.get("requestId"));
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
    eventLog,
    logTransition,
    resultToJson,
    opts.config ?? null,
    requestClient,
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
 * startup if a required var is missing) and build the app with real config.
 *
 * The only injected I/O port is `request_client` (= the `fetch` library);
 * production relies on the `globalThis.fetch` default, so no extra wiring is
 * needed. `getWorkOSUserInfo` + `getOrgAndReissue` read their URLs from the
 * config threaded into the machine input and perform their network calls through
 * `deps.request_client`; the forced-failure harness knob (already gated at the
 * router edge) is threaded as `force_reissue_failures` and folded into
 * `getOrgAndReissue` via attempt-vs-budget.
 */
function buildProductionApp(): Hono {
  const config = loadConfig();
  const eventLog = selectFlowEventLog(config.redisUrl);
  return buildSessionOnboardingApp({ eventLog, config });
}

const app =
  process.env.UI_STATE_AUTOSTART === "false" ? new Hono() : buildProductionApp();

if (process.env.UI_STATE_AUTOSTART !== "false") {
  serve({ fetch: app.fetch, port: parseInt(process.env.PORT ?? "8788", 10) });
}

export { app };
