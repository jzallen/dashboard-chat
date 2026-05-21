// UI-State Tier — Hono server entry point.
//
// Routes (ADR-040 §D4/§D5 — per-machine sub-routers, no :machine param):
//   GET  /health                                    — liveness check
//   {/flow/login-and-org-setup, /flow/project-context (+ legacy alias
//    /flow/project-and-chat-session-management), /flow/session-chat} each
//    mount a per-machine sub-router carrying:
//      POST .../begin            — begin a flow, returns projection
//      POST .../event            — send event to existing flow
//      POST .../freeze|/thaw     — cross-machine FREEZE/THAW (US-210)
//      POST .../open-deep-link   — deep-link / scope resolution
//      GET  .../projection?flow_id=…        — read current projection
//      GET  .../projection/stream?flow_id=… — SSE projection stream
//   A terminal /flow/:machine/* guard maps an unknown machine to the
//   LEAF-1 clean 404 (registry miss); it is a boundary, not dispatch.
//
// Each per-machine sub-router lives at `lib/machines/<machine>/router.ts`
// — co-located with the XState machine it transports (ADR-028 invariant:
// no machine imports another machine; the orchestrator stays the sole
// cross-machine mediator). The strategy-agnostic routes (`/freeze`,
// `/thaw`, `/projection`, `/projection/stream`) are mounted by the shared
// substrate at `lib/hexagonal-transport/flow-router.ts` so the per-machine
// routers carry only their machine-specific transport (begin / event /
// open-deep-link).
//
// Wiring: composition root creates the FlowEventLog adapter via
// capability-presence dispatch (REDIS_URL set → Redis tier; unset → noop),
// builds the LoginAndOrgSetup machine deps, and constructs the orchestrator.
//
// Auth: this tier trusts the X-User-Id / X-Org-Id / X-User-Email headers
// injected by auth-proxy upstream (ADR-016). It does NOT re-verify JWTs.
// In AUTH_MODE=dev the headers identify the dev user.

import { probe } from "@dashboard-chat/shared-failure-simulation";
import { serve } from "@hono/node-server";
import type { Context } from "hono";
import { Hono } from "hono";

import {
  createOrgAndReissueActor,
  createOrgFn,
  createWorkOSUserInfoActor,
  reissueOrgJwtFn,
} from "./lib/machines/login-and-org-setup/index.ts";
import { buildLoginAndOrgSetupRouter } from "./lib/machines/login-and-org-setup/router.ts";
import {
  createProjectActor,
  resolveInitialScopeActor,
  switchProjectActor,
} from "./lib/machines/project-context/index.ts";
import {
  buildProjectContextRouter,
  forceCreateProjectFailureFlag,
  shouldFailListSessions,
  slowSwitchMsFlag,
} from "./lib/machines/project-context/router.ts";
import {
  createSessionEagerlyActor,
  loadSessionListActor,
  resumeSessionActor,
  switchDatasetContextActor,
} from "./lib/machines/session-chat/index.ts";
import {
  buildSessionChatRouter,
  forceCreateSessionFailureFlag,
  slowResumeMsFlag,
} from "./lib/machines/session-chat/router.ts";
import {
  FLOW_STRATEGY_REGISTRY,
  FlowOrchestrator,
  type FlowStrategy,
  UnknownMachineError,
} from "./lib/orchestrator.ts";
import { selectFlowEventLog } from "./lib/persistence/redis.ts";

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
  projectContextMachineDeps: {
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
    // MR-4 — atomic project switching (US-207 + IC-J002-4).
    switchProject: switchProjectActor(
      BACKEND_URL,
      DEFAULT_PRINCIPAL_HEADERS,
      slowSwitchMsFlag,
    ),
  },
  // Session-chat (DWD-13 §2B) — MR-2 wires loadSessionList + resumeSession.
  // Presence of this object (vs `undefined`) is the orchestrator's signal
  // to fire the `project_ready` broadcast hook on project-context
  // `project_selected`. MR-3 adds createSessionEagerly; MR-5 adds
  // switchDatasetContext (US-209 — dataset context switching).
  sessionChatMachineDeps: {
    loadSessionList: loadSessionListActor(BACKEND_URL, DEFAULT_PRINCIPAL_HEADERS),
    resumeSession: resumeSessionActor(
      BACKEND_URL,
      DEFAULT_PRINCIPAL_HEADERS,
      slowResumeMsFlag,
    ),
    createSessionEagerly: createSessionEagerlyActor(
      BACKEND_URL,
      DEFAULT_PRINCIPAL_HEADERS,
      forceCreateSessionFailureFlag,
    ),
    // MR-5 — US-209 dataset context switching.
    switchDatasetContext: switchDatasetContextActor(
      BACKEND_URL,
      DEFAULT_PRINCIPAL_HEADERS,
    ),
  },
  createOrgFn: createOrgFn(BACKEND_URL, DEFAULT_PRINCIPAL_HEADERS),
  reissueOrgJwtFn: reissueOrgJwtFn(BACKEND_URL, DEFAULT_PRINCIPAL_HEADERS),
});

const app = new Hono();

/**
 * Per-machine router builder map (ADR-040 §D4/§D5 — strategy-keyed by
 * canonical machine-name; ADR-028 — orchestrator is the sole cross-machine
 * mediator, so importing all three machine packages from this composition
 * root is the one allowed cross-machine reach). Keyed by canonical name
 * because the registry already canonicalizes legacy wire names via the
 * D5 alias map — `makeFlowRouter` resolves the strategy first, then looks
 * the builder up by `strategy.machineName`. Zero `machine === "<wire>"`
 * branches in the dispatch path.
 */
const FLOW_ROUTER_BUILDERS: Record<
  string,
  (orchestrator: FlowOrchestrator, wireName: string) => Hono
> = {
  "login-and-org-setup": buildLoginAndOrgSetupRouter,
  "project-context": buildProjectContextRouter,
  "session-chat": buildSessionChatRouter,
};

/**
 * Wire the ui-state routes onto the supplied Hono app, using the supplied
 * orchestrator as the state owner. Extracted so tests can build a scenario-
 * scoped app + orchestrator pair without invoking the production composition
 * root (which probes Redis, binds the port, and constructs the WorkOS / backend
 * adapters).
 */
export function wireRoutes(app: Hono, orchestrator: FlowOrchestrator): void {
  // Composition-root failure-simulation probe per ADR-035 + ADR-036. Runs
  // once per wireRoutes invocation: production binds routes once at module
  // load (`wireRoutes(app, orchestrator)` below); per-scenario test
  // harnesses build a fresh app + orchestrator pair and call `wireRoutes`
  // themselves, so the gate verdict is refreshed against the scenario's
  // process.env at that point. The verdict is cached inside the shared
  // package and consumed by `shouldInject()` callsites in the per-machine
  // router layer.
  probe(process.env, "ui-state");

  app.get("/health", (c) => c.json({ status: "ok" }));

  /**
   * ADR-040 §D4/§D5 (LEAF-2) — per-machine sub-router factory. Resolves
   * the FlowStrategy via the LEAF-1 registry (D5 alias-aware) and produces
   * the corresponding per-machine Hono router. Dispatch is strategy-keyed:
   * the resolved `strategy.machineName` indexes `FLOW_ROUTER_BUILDERS`, so
   * there is no `machine === "<wire>"` conditional in the pump or here.
   * A mis-wired mount fails loudly at startup (registry miss throws; an
   * unknown canonical name throws below) so it cannot introduce a runtime
   * behavior delta. `wireName` is the wire-protocol machine name forwarded
   * to the orchestrator — intentionally the established (legacy-stable)
   * segment for project-context (`project-and-chat-session-management`)
   * because `flow_id = "<wireName>:<principal_id>"` (orchestrator §8) is
   * the Redis event-log key, the J002 membership key, and the
   * `FlowProjection.flow_id` wire field. LEAF-6 flips this to the
   * canonical name once the FE / acceptance suite migrate.
   */
  function makeFlowRouter(strategy: FlowStrategy, wireName: string): Hono {
    if (FLOW_STRATEGY_REGISTRY.resolve(wireName) !== strategy) {
      throw new Error(
        `makeFlowRouter: wire name "${wireName}" does not resolve to ` +
          `strategy "${strategy.machineName}"`,
      );
    }
    const build = FLOW_ROUTER_BUILDERS[strategy.machineName];
    if (!build) {
      throw new Error(
        `makeFlowRouter: no router builder for "${strategy.machineName}"`,
      );
    }
    return build(orchestrator, wireName);
  }

  // ── Per-machine mounts (ADR-040 §D4/§D5, LEAF-2) ──────────────────────
  // Each strategy is resolved from the LEAF-1 registry by its canonical
  // machine-name and mounted at /flow/<canonical>. The project machine is
  // ALSO mounted at its legacy feature-slug path against the SAME router
  // instance (ADR-040 D5 example) so the ADR-027 §1 FE projection contract
  // and the nginx / auth-proxy `/ui-state/` proxy resolve identically
  // through the migration with no 404 window. session-chat /
  // login-and-org-setup have canonical == legacy segment (no true alias
  // pair) and mount once.
  const loginRouter = makeFlowRouter(
    FLOW_STRATEGY_REGISTRY.resolve("login-and-org-setup"),
    "login-and-org-setup",
  );
  app.route("/flow/login-and-org-setup", loginRouter);

  const projectRouter = makeFlowRouter(
    FLOW_STRATEGY_REGISTRY.resolve("project-context"),
    // Established wire name — keeps flow_id / Redis key / projection bytes
    // identical to the pre-LEAF-2 baseline through BOTH mounts. LEAF-6
    // flips this to the canonical name once the FE/suite migrate.
    "project-and-chat-session-management",
  );
  app.route("/flow/project-context", projectRouter);
  app.route("/flow/project-and-chat-session-management", projectRouter);

  const sessionChatRouter = makeFlowRouter(
    FLOW_STRATEGY_REGISTRY.resolve("session-chat"),
    "session-chat",
  );
  app.route("/flow/session-chat", sessionChatRouter);

  // Terminal registry-miss boundary (LEAF-1 contract; ADR-040
  // Consequences "unknown-machine becomes a clean 404, no conditional
  // fall-through"). The per-machine mounts above own all flow DISPATCH;
  // this is the ONLY surviving `:machine` reference and is NOT a dispatch
  // route — it reproduces the LEAF-1 unknown-machine clean 404 (registry
  // miss) byte-for-byte for any /flow/<unknown>/* path, and defers to
  // Hono's default not-found for an unknown sub-path of a known machine
  // (the pre-LEAF-2 behavior for those paths). Registered AFTER the mounts
  // so a matched sub-router always responds first.
  app.all("/flow/:machine/*", (c) => {
    const machine = c.req.param("machine");
    try {
      FLOW_STRATEGY_REGISTRY.resolve(machine);
    } catch (err) {
      return flowDispatchError(c, err, "begin_failed");
    }
    return c.notFound();
  });
}

// Production composition: wire routes onto the module-level app + orchestrator.
wireRoutes(app, orchestrator);

// ADR-040 §D5 / Consequences: an unknown machine is a clean 404 registry
// miss, never a 500 conditional fall-through. Every other dispatch failure
// keeps its prior `{ error, message }` 500 shape byte-identical so the
// J-002 acceptance suite stays behavior-neutral.
function flowDispatchError(
  c: Context,
  err: unknown,
  fallbackError: string,
): Response {
  if (err instanceof UnknownMachineError) {
    return c.json({ error: "unknown_machine", machine: err.machine }, 404);
  }
  return c.json(
    { error: fallbackError, message: (err as Error).message },
    500,
  );
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
