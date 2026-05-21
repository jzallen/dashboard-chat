import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { resolveActiveScope } from "./lib/active-scope.ts";
import type { LoginMachineDeps } from "./lib/machines/login-and-org-setup/index.ts";
import {
  buildLoginAndOrgSetupRouter,
  type BuildLoginDeps,
} from "./lib/machines/login-and-org-setup/router.ts";
import type { FlowOrchestrator } from "./lib/orchestrator.ts";

/**
 * Mint a reference code — the support-facing trace handle a flow surfaces to
 * the user. Shared by the top-level routes that begin a flow; honored from
 * the X-Correlation-Id ingress header when present, generated otherwise.
 */
function generateReferenceCode(): string {
  return crypto.randomUUID();
}

type LoginRouterEnv = {
  Variables: {
    referenceCode: string;
    userId: string;
  };
};

function loginRouter(): Hono<LoginRouterEnv> {
  // Placeholders — real orchestrator + login-deps construction (WorkOS
  // userinfo, org-create + reissue, silent reauth, and the forced-failure
  // wrapper) get wired here next. buildLoginDeps is the single seam where the
  // force-reissue-failures knob resolves into the createOrgAndReissue actor.
  const orchestrator = {} as FlowOrchestrator;
  const buildLoginDeps: BuildLoginDeps = () => ({}) as LoginMachineDeps;
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
    await next();
  });

  return buildLoginAndOrgSetupRouter(
    router,
    orchestrator,
    resolveActiveScope,
    buildLoginDeps,
  );
}

const app = new Hono();
app.route("/flow/login-and-org-setup", loginRouter());

if (process.env.UI_STATE_AUTOSTART !== "false") {
  serve({ fetch: app.fetch, port: parseInt(process.env.PORT ?? "8788", 10) });
}

export { app };
