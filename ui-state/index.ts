// UI-State Tier — Hono server entry point.
//
// Routes (ADR-040 §D4/§D5 — per-machine sub-routers, no :machine param):
//   GET  /health                                    — liveness check
//   {/flow/login-and-org-setup, /flow/project-context (+ legacy alias
//    /flow/project-and-chat-session-management), /flow/session-chat} each
//    mount a makeFlowRouter() instance carrying:
//      POST .../begin            — begin a flow, returns projection
//      POST .../event            — send event to existing flow
//      POST .../freeze|/thaw     — cross-machine FREEZE/THAW (US-210)
//      POST .../open-deep-link   — deep-link / scope resolution
//      GET  .../projection?flow_id=…        — read current projection
//      GET  .../projection/stream?flow_id=… — SSE projection stream
//   A terminal /flow/:machine/* guard maps an unknown machine to the
//   LEAF-1 clean 404 (registry miss); it is a boundary, not dispatch.
//
// Wiring: composition root creates the FlowEventLog adapter via
// capability-presence dispatch (REDIS_URL set → Redis tier; unset → noop),
// builds the LoginAndOrgSetup machine deps, and constructs the orchestrator.
//
// Auth: this tier trusts the X-User-Id / X-Org-Id / X-User-Email headers
// injected by auth-proxy upstream (ADR-016). It does NOT re-verify JWTs.
// In AUTH_MODE=dev the headers identify the dev user.

import { KNOB, probe, shouldInject } from "@dashboard-chat/shared-failure-simulation";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import type { Context } from "hono";

import type { ResourceType } from "./lib/active-scope.ts";
import { resolveActiveScope } from "./lib/active-scope.ts";
import { type Result, errorMessage } from "./lib/flow-result.ts";
import {
  createOrgAndReissueActor,
  createOrgFn,
  createWorkOSUserInfoActor,
  reissueOrgJwtFn,
} from "./lib/machines/login-and-org-setup/index.ts";
import {
  createProjectActor,
  resolveInitialScopeActor,
  switchProjectActor,
} from "./lib/machines/project-context/index.ts";
import {
  createSessionEagerlyActor,
  loadSessionListActor,
  resumeSessionActor,
  switchDatasetContextActor,
} from "./lib/machines/session-chat/index.ts";
import {
  FLOW_STRATEGY_REGISTRY,
  type FlowStrategy,
  FlowOrchestrator,
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

// J-002 harness knob: per-process counter; the next `create_project_submitted`
// event whose request bears `X-Force-Create-Project-Failure: transient`
// makes the actor throw a transient error before any backend call. Used by
// the US-201 transient-failure acceptance scenario (mirrors J-001's
// `__force_failure__` pattern but at the actor level).
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

// J-002 MR-3 harness knob: the next `first_message_sent` event whose
// request bears `X-Force-Create-Session-Failure: transient` makes the
// `createSessionEagerly` actor throw a transient error before any backend
// call. Used by the US-206 transient-failure acceptance scenario (mirrors
// the `forceCreateProjectFailureNext` flag at the create-project boundary).
let forceCreateSessionFailureNext = false;
function forceCreateSessionFailureFlag(): boolean {
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
function slowResumeMsFlag(): number {
  const v = forceSlowResumeMsNext;
  forceSlowResumeMsNext = 0;
  return v;
}

// US-210 test-infra knob (consume-once, gated) — project-context analog
// of slowResumeMsFlag. The next switching_project_intent bearing
// X-Force-Slow-Switch-Project: <ms> holds the switchProject invoke so
// the scenario-2 acceptance test can broadcast FREEZE while the machine
// is still in `switching_project`. Not a product behavior.
let forceSlowSwitchMsNext = 0;
function slowSwitchMsFlag(): number {
  const v = forceSlowSwitchMsNext;
  forceSlowSwitchMsNext = 0;
  return v;
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
 * Wire the ui-state routes onto the supplied Hono app, using the supplied
 * orchestrator as the state owner. Extracted so tests can build a scenario-
 * scoped app + orchestrator pair without invoking the production composition
 * root (which probes Redis, binds the port, and constructs the WorkOS / backend
 * adapters).
 */
export function wireRoutes(app: Hono, orchestrator: FlowOrchestrator): void {

// Composition-root failure-simulation probe per ADR-035 + ADR-036. Runs once
// per wireRoutes invocation: production binds routes once at module load
// (`wireRoutes(app, orchestrator)` below); per-scenario test harnesses build
// a fresh app + orchestrator pair and call `wireRoutes` themselves, so the
// gate verdict is refreshed against the scenario's process.env at that
// point. The verdict is cached inside the shared package and consumed by
// `shouldInject()` callsites elsewhere in this module + the machine layer.
probe(process.env, "ui-state");

app.get("/health", (c) => c.json({ status: "ok" }));

  /**
   * ADR-040 §D4/§D5 (LEAF-2) — per-machine sub-router factory. Produces a
   * Hono instance carrying the full flow transport surface (begin / event /
   * freeze / thaw / open-deep-link / projection / projection-stream). One
   * instance is mounted per canonical machine-name AND, for the project
   * machine, additionally at its legacy feature-slug path against the SAME
   * instance — so the ADR-027 §1 FE projection contract and the nginx /
   * auth-proxy `/ui-state/` proxy resolve identically through the migration
   * with NO 404 window. The `:machine` dispatch parameter is retired.
   *
   * `wireName` is the wire-protocol machine name forwarded to the
   * orchestrator. It is intentionally the established (legacy-stable)
   * segment — `project-and-chat-session-management` for the project
   * machine — because `flow_id = "<wireName>:<principal_id>"` (orchestrator
   * §8) is the Redis event-log key, the `J002_MACHINES` membership key, and
   * the `FlowProjection.flow_id` wire field. Forwarding the established
   * name keeps every byte identical to the pre-LEAF-2 baseline through
   * BOTH mounts; the LEAF-1 registry still canonicalizes it via the D5
   * alias (`resolve()`), so no alias logic is reimplemented here. LEAF-6
   * flips this to the canonical name once the FE/suite migrate.
   */
  function makeFlowRouter(strategy: FlowStrategy, wireName: string): Hono {
    // Composition-time guard: the wire name MUST resolve, via the LEAF-1
    // registry's D5 alias, to exactly this strategy. Keeps the HTTP mount
    // and registry dispatch in lockstep (ADR-040 C4: router -> registry ->
    // strategy) — a mis-wired mount fails loudly at startup, never at
    // request time (so it cannot introduce a runtime behavior delta).
    if (FLOW_STRATEGY_REGISTRY.resolve(wireName) !== strategy) {
      throw new Error(
        `makeFlowRouter: wire name "${wireName}" does not resolve to ` +
          `strategy "${strategy.machineName}"`,
      );
    }
    const router = new Hono();

    router.post("/begin", async (c) => {
  const machine = wireName;
  const correlation_id =
    c.req.header("X-Correlation-Id") ?? cryptoRandomId();
  let body: {
    persona_email?: string;
    persona_display_name?: string;
    existing_org_names?: string[];
    force_reissue_failures?: number;
    principal_id?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return c.json({ error: "invalid_request" }, 400);
  }

  // J-001 requires the persona_email to drive the WorkOS exchange. J-002
  // (and other non-J-001 machines) spawn via the orchestrator's auth_ready
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
    // J-002 force-list-sessions-failure knob — header transport. The
    // X-Force-List-Sessions-Failure wire value (comma-separated project ids)
    // is unchanged; the gate consultation routes through the shared
    // failure-simulation registry so the verdict honors the ADR-035 gate and
    // the audit envelope captures the header value. Cleared each /begin so
    // test scenarios don't leak state.
    forceListSessionsFailures.clear();
    if (
      machine === "project-and-chat-session-management" &&
      shouldInject(KNOB.forceListSessionsFailure, {
        headers: c.req.raw.headers,
        correlationId: correlation_id,
        serviceName: "ui-state",
      })
    ) {
      const forceFailHeader = c.req.header("X-Force-List-Sessions-Failure") ?? "";
      for (const raw of forceFailHeader.split(",")) {
        const id = raw.trim();
        if (id) forceListSessionsFailures.add(id);
      }
    }
    const result = await orchestrator.beginIfNotStarted({
      machine,
      principal_id,
      correlation_id,
      org_id: orgId,
      user_first_name: firstName,
      force_restart: true,
    });
    return resultToJson(c, result, "begin_failed");
  }

  // force-reissue-failures knob — body-field transport. Phase-2 vocabulary
  // cleanup per ADR-038: the wire body field is `force_reissue_failures`,
  // the legacyAlias bridge is dropped. The gate routes through the shared
  // registry so the verdict + audit envelope are uniform across all six
  // knobs. The orchestrator retains its own NWAVE_HARNESS_KNOBS check as
  // defense in depth during the one-release env-var overlap window.
  const reissueFailuresAllowed = shouldInject(KNOB.forceReissueFailures, {
    body: body as Record<string, unknown>,
    correlationId: correlation_id,
    serviceName: "ui-state",
  });
  const result = await orchestrator.begin({
    machine,
    principal_id,
    persona_email: body.persona_email ?? "",
    persona_display_name: body.persona_display_name ?? "",
    correlation_id,
    existing_org_names: body.existing_org_names,
    force_reissue_failures: reissueFailuresAllowed
      ? body.force_reissue_failures
      : undefined,
  });
  return resultToJson(c, result, "begin_failed");
});

    router.post("/event", async (c) => {
  const machine = wireName;
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

  // force-failure-on-auth-retry knob — event transport. The __force_failure__
  // wire event drives the login-and-org-setup machine into error_recoverable
  // with the supplied cause tag (DWD-1). Production deployments must refuse
  // this event so a malicious caller can't bypass real auth flow logic; the
  // ADR-035 gate (ENVIRONMENT × flag) is the closed-by-default decision and
  // the registry surfaces a failure-simulation.rejected audit entry when the
  // event arrives in a denying tier. Wire form `__force_failure__` derives
  // from canonical via the eventDistinguisher rendering rule (ADR-038).
  if (body.type === "__force_failure__") {
    const allowed = shouldInject(KNOB.forceFailureOnAuthRetry, {
      event: { type: body.type },
      correlationId: correlation_id,
      serviceName: "ui-state",
    });
    if (!allowed) {
      return c.json(
        {
          error:
            "failure-simulation knob disabled: __force_failure__ requires the gate enabled (ENVIRONMENT=dev|ci + flag set)",
        },
        403,
      );
    }
  }

  // expire-token knob — event transport. The __expire_token__ wire event
  // drives the login-and-org-setup machine from `ready` into `expired_token`
  // to exercise silent re-auth (DWD-1). The gate decision routes through
  // shouldInject(KNOB.expireToken, { event, ... }) and emits the ADR-037
  // audit envelope. Phase-2 vocabulary cleanup per ADR-038 — the legacyAlias
  // bridge is dropped and the wire event type now matches the registry's
  // canonical-derived rendering.
  if (body.type === "__expire_token__") {
    const allowed = shouldInject(KNOB.expireToken, {
      event: { type: body.type },
      correlationId: correlation_id,
      serviceName: "ui-state",
    });
    if (!allowed) {
      return c.json(
        {
          error:
            "failure-simulation knob disabled: __expire_token__ requires the gate enabled (ENVIRONMENT=dev|ci + flag set)",
        },
        403,
      );
    }
  }

  // J-002 force-create-project-failure knob — header transport. The wire
  // signal (X-Force-Create-Project-Failure) is unchanged; the gate
  // consultation routes through the shared failure-simulation registry
  // (ADR-035 + ADR-038) so the verdict honors ENVIRONMENT × flag composition
  // and emits the audit envelope. The post-knob effect (consume-once flag)
  // is preserved end-to-end so the actor's per-invoke check is unchanged.
  if (
    machine === "project-and-chat-session-management" &&
    body.type === "create_project_submitted" &&
    shouldInject(KNOB.forceCreateProjectFailure, {
      headers: c.req.raw.headers,
      correlationId: correlation_id,
      serviceName: "ui-state",
    })
  ) {
    forceCreateProjectFailureNext = true;
  }

  // J-002 force-create-session-failure knob — header transport. The
  // X-Force-Create-Session-Failure wire header is unchanged; the gate
  // consultation routes through the shared failure-simulation registry per
  // ADR-035 / ADR-038. Matches the create-project pattern above — gated,
  // consumed once by the actor's per-invoke check.
  if (
    machine === "session-chat" &&
    body.type === "first_message_sent" &&
    shouldInject(KNOB.forceCreateSessionFailure, {
      headers: c.req.raw.headers,
      correlationId: correlation_id,
      serviceName: "ui-state",
    })
  ) {
    forceCreateSessionFailureNext = true;
  }

  // US-210 slow-resume knob — header transport (X-Force-Slow-Resume: <ms>).
  // Gated via the same KNOB.expireToken freeze/expiry test family. Lets the
  // scenario-1 acceptance test broadcast FREEZE while resuming_session is
  // still in flight (the in-flight 401-discard contract). Consumed once.
  if (
    machine === "session-chat" &&
    body.type === "session_clicked" &&
    c.req.header("X-Force-Slow-Resume") &&
    shouldInject(KNOB.expireToken, {
      event: { type: "__expire_token__" },
      correlationId: correlation_id,
      serviceName: "ui-state",
    })
  ) {
    const ms = Number.parseInt(
      c.req.header("X-Force-Slow-Resume") ?? "0",
      10,
    );
    forceSlowResumeMsNext = Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  if (
    machine === "project-and-chat-session-management" &&
    body.type === "switching_project_intent" &&
    c.req.header("X-Force-Slow-Switch-Project") &&
    shouldInject(KNOB.expireToken, {
      event: { type: "__expire_token__" },
      correlationId: correlation_id,
      serviceName: "ui-state",
    })
  ) {
    const ms = Number.parseInt(
      c.req.header("X-Force-Slow-Switch-Project") ?? "0",
      10,
    );
    forceSlowSwitchMsNext = Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  const result = await orchestrator.send({
    machine,
    flow_id: body.flow_id,
    type: body.type,
    payload: body.payload ?? {},
    correlation_id,
  });
  return resultToJson(c, result, "event_failed");
});

// Cross-machine FREEZE / THAW test-driving endpoints (US-005 / US-210).
//
// Per the harness four-piece contract
// (`tests/acceptance/user-flow-state-machines/harness/README.md` §1):
// `POST /flow/<machine>/freeze` and `/thaw` represent the orchestrator
// broadcast J-001's `expired_token` → silent-reauth lifecycle drives.
// The live compose stack does NOT wire a `silentReauth` actor (recovery
// is deferred-to-UI2 in J-001's own suite), so these endpoints expose the
// EXISTING `orchestrator.broadcastFreeze` / `broadcastThaw` substrate
// methods (byte-unchanged — ADR-028 / DWD-6 / C9) to the test wire,
// exactly as `__expire_token__` exposes token expiry. They are test-only:
// gated by the same `KNOB.expireToken` failure-simulation gate (ADR-035 ×
// flag, closed by default in production). J-002 emits NOTHING here — it is
// a pure downstream consumer (ADR-028:46-48).
//
// `originFlowId` is the J-001 login flow id for the principal. The
// broadcast loop skips the origin and reaches every other spawned actor
// (both J-002 flows for the principal) — so the J-001 actor need not even
// exist; the id is only the skip key.
function freezeThawHandler(kind: "freeze" | "thaw") {
  return async (c: Context) => {
    const correlation_id =
      c.req.header("X-Correlation-Id") ?? cryptoRandomId();
    let body: { principal_id?: string; reason?: "thaw" | "abandoned" };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      body = {};
    }
    const principal_id =
      c.req.header("X-User-Id") || body.principal_id || "anon";
    // Gate under the expire-token knob: /freeze + /thaw ARE the
    // orchestrator broadcast lifecycle that J-001's `__expire_token__` →
    // silent-reauth drives. The manifest gates `KNOB.expireToken` to the
    // `__expire_token__` wire event (transport-match), so consult it with
    // that canonical type — these endpoints belong to the same
    // token-expiry test family (ADR-035 closed-by-default in production).
    const allowed = shouldInject(KNOB.expireToken, {
      event: { type: "__expire_token__" },
      correlationId: correlation_id,
      serviceName: "ui-state",
    });
    if (!allowed) {
      return c.json(
        {
          error:
            `failure-simulation knob disabled: /${kind} requires the gate ` +
            `enabled (ENVIRONMENT=dev|ci + flag set)`,
        },
        403,
      );
    }
    const originFlowId = `login-and-org-setup:${principal_id}`;
    const result =
      kind === "freeze"
        ? await orchestrator.broadcastFreeze(originFlowId)
        : await orchestrator.broadcastThaw(
            originFlowId,
            body.reason === "abandoned" ? "abandoned" : "thaw",
          );
    if (!result.ok) {
      return c.json(
        { error: `${kind}_failed`, message: errorMessage(result.error) },
        500,
      );
    }
    return c.json({ status: "ok", kind, principal_id });
  };
}
    router.post("/freeze", freezeThawHandler("freeze"));
    router.post("/thaw", freezeThawHandler("thaw"));

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
//       resource_type?: "dataset",       // see ADR-039 §Q1
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
    router.post("/open-deep-link", async (c) => {
  const machine = wireName;
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
    // Ensure J-002 is spawned; idempotent.
    const spawn = await orchestrator.beginIfNotStarted({
      machine,
      principal_id: principalId,
      correlation_id,
      org_id: orgId,
      user_first_name: firstName ?? "",
    });
    if (!spawn.ok) {
      return resultToJson(c, spawn, "open_deep_link_failed");
    }
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
    const result = await orchestrator.send({
      machine,
      flow_id: flowId,
      type: "open_deep_link",
      payload,
      correlation_id,
    });
    return resultToJson(c, result, "open_deep_link_failed");
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

  if (!resolution.ok) {
    // I1 / I4: cross-tenant URL. Surface the named diagnostic via a
    // scope_access_denied event. The projection's `state` flips to
    // `access_denied` and `scope_resolution_error.reason` names the cause.
    const result = await orchestrator.appendDeepLinkEvents({
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
    return resultToJson(c, result, "open_deep_link_failed");
  }

  // Successful resolution: emit deep_link_opened. If reconciled (I5), the
  // event payload carries reconciled=true; the reducer surfaces a
  // scope_reconciled signal in the projection that an accompanying test
  // agent can observe.
  const result = await orchestrator.appendDeepLinkEvents({
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
  return resultToJson(c, result, "open_deep_link_failed");
});

    router.get("/projection", async (c) => {
  const flow_id = c.req.query("flow_id");
  if (!flow_id) {
    return c.json({ error: "flow_id required" }, 400);
  }
  const result = await orchestrator.getProjection(flow_id);
  if (!result.ok) {
    return c.json(
      { error: "projection_failed", message: errorMessage(result.error) },
      500,
    );
  }
  return c.json(result.value);
});

// SSE projection-stream per DWD-9 + RD2 (cross-tab refresh substrate for
// US-203 Example 4). Long-polls the flow's Redis event-log via XREAD BLOCK
// and pushes a freshly-computed projection on each new event. Bounded by a
// server-side budget (default 25s) so intermediaries don't trip; clients
// reconnect on close. The reverse-proxy must NOT buffer this response (the
// `X-Accel-Buffering: no` header is the canonical nginx hint).
    router.get("/projection/stream", async (c) => {
  const flow_id = c.req.query("flow_id");
  if (!flow_id) {
    return c.json({ error: "flow_id required" }, 400);
  }
  const sinceParam = c.req.query("since") ?? "$";
  const budgetMsParam = c.req.query("budget_ms");
  const budgetMs = Math.min(
    Math.max(parseInt(budgetMsParam ?? "25000", 10) || 25_000, 1_000),
    60_000,
  );

  const headers: Record<string, string> = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "x-accel-buffering": "no",
    connection: "keep-alive",
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const writeEvent = (event: string, data: unknown): void => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        // First frame: the current projection (so callers don't need to
        // race a separate GET /projection request).
        const initial = await orchestrator.getProjection(flow_id);
        if (!initial.ok) throw new Error(errorMessage(initial.error));
        writeEvent("projection", initial.value);
        // Then subscribe to subsequent events. Each new event triggers a
        // fresh projection read so consumers see the up-to-date envelope.
        for await (const _event of orchestrator.subscribeToFlow(
          flow_id,
          sinceParam,
          budgetMs,
        )) {
          const projection = await orchestrator.getProjection(flow_id);
          if (!projection.ok) throw new Error(errorMessage(projection.error));
          writeEvent("projection", projection.value);
        }
      } catch (err) {
        writeEvent("error", { message: (err as Error).message });
      } finally {
        try {
          controller.close();
        } catch {
          // Defensive — the client may have closed the connection already.
        }
      }
    },
  });

  return new Response(stream, { headers, status: 200 });
});

    return router;
  } // end makeFlowRouter

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

// Total mapper for the orchestrator's Result API: success serializes the
// projection; `unknown_machine` is the registry-miss 404; every other
// failure keeps the prior `{ error, message }` 500 shape byte-identical.
function resultToJson(
  c: Context,
  result: Result<unknown>,
  fallbackError: string,
): Response {
  if (result.ok) {
    return c.json(result.value);
  }
  if (result.error.kind === "unknown_machine") {
    return c.json(
      { error: "unknown_machine", machine: result.error.machine },
      404,
    );
  }
  return c.json(
    { error: fallbackError, message: result.error.message },
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
