// UI-State Tier — Hono server entry point (ADR-044 Phase 4).
//
// The live ui-state app is now driven by the ChatApp coordinator actor (one per
// principal) — the declarative successor to the imperative FlowOrchestrator. A
// single router factory (lib/machines/chat-app/router.ts) is mounted under every
// wire-machine path; each mount derives its own machine's FlowProjection from the
// shared per-principal ChatApp snapshot (deriveProjection), so the frozen ADR-027
// read contract holds byte-stable for all three machines:
//
//   GET  /flow/{session-onboarding,login-and-org-setup}/projection      → onboarding slice
//   GET  /flow/{project-context,project-and-chat-session-management}/…   → project-context slice
//   GET  /flow/session-chat/projection                                  → session-chat slice
//   POST /flow/{…}/{begin,event,open-deep-link}                         → drive the ChatApp actor
//   GET  /flow/{…}/projection/stream                                    → SSE substrate
//   GET  /health
//
// Persistence is the ADR-044 §2 hybrid: the live actor is the state-of-record
// (getPersistedSnapshot via ChatAppSnapshotStore, hot-restart recovery); the
// append-only FlowEventLog is RETAINED but demoted to SSE/audit + projection
// bookkeeping. There is NO /freeze + /thaw — ChatApp's freeze/reauth region was
// retired (ADR-043 / ADR-044 amendment); auth-proxy owns the token lifecycle
// (ADR-016).
//
// Auth: this tier trusts the X-User-Id / X-Org-Id / X-User-Email headers injected
// by auth-proxy upstream (ADR-016). It does NOT re-verify JWTs except the
// onboarding child's re-verify of the forwarded Bearer against WorkOS.

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { type Config, loadConfig } from "./config.ts";
import type { ChatAppDeps } from "./lib/machines/chat-app/index.ts";
import {
  buildChatAppRouter,
  ChatAppActorRegistry,
  type ChatAppRuntime,
} from "./lib/machines/chat-app/router.ts";
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
import type { RequestClient } from "./lib/machines/session-onboarding/index.ts";
import {
  type ChatAppSnapshotStore,
  selectChatAppSnapshotStore,
} from "./lib/persistence/chatapp-snapshot-store.ts";
import { type FlowEventLog, selectFlowEventLog } from "./lib/persistence/redis.ts";

/** The wire-machine paths the live app serves. Each pair mounts the SAME router
 *  factory baked with that path's wire-machine name — so the alias paths resolve
 *  to the right child slice + synthesize the right flow_id (ADR-040/041, derived
 *  via deriveProjection's WIRE_TO_CHILD). */
const WIRE_PATHS: ReadonlyArray<readonly [path: string, wireMachine: string]> = [
  ["/flow/session-onboarding", "session-onboarding"],
  ["/flow/login-and-org-setup", "login-and-org-setup"],
  ["/flow/project-context", "project-context"],
  [
    "/flow/project-and-chat-session-management",
    "project-and-chat-session-management",
  ],
  ["/flow/session-chat", "session-chat"],
];

/**
 * Compose the live ChatApp-backed app onto a fresh Hono instance. This is the
 * composition seam: production calls it with the real stores + child resolver
 * actors built from config; the in-process tests inject a noop event-log + noop
 * snapshot store + `fromPromise` child fakes + a mock `fetch` (the onboarding
 * I/O port).
 */
export function buildChatAppApp(opts: {
  eventLog: FlowEventLog;
  snapshotStore: ChatAppSnapshotStore;
  /** The project-context + session-chat resolver actors (construction-time DI).
   *  Production builds these from config; tests pass `fromPromise` fakes. */
  chatAppDeps: ChatAppDeps;
  /** Env config threaded into the onboarding child's invoke input (its re-verify
   *  + org-create resolvers read workosUrl/backendUrl from input). */
  config?: Config | null;
  /** The fetch I/O port the onboarding child's resolvers call. Defaults to
   *  globalThis.fetch so production needs no extra wiring; tests inject a mock. */
  requestClient?: RequestClient;
  logTransition?: (record: Record<string, unknown>) => void;
}): Hono {
  const logTransition =
    opts.logTransition ??
    ((record: Record<string, unknown>): void => {
      process.stdout.write(
        `${JSON.stringify({ event: "flow.transition", ...record })}\n`,
      );
    });

  const runtime: ChatAppRuntime = {
    chatAppDeps: opts.chatAppDeps,
    eventLog: opts.eventLog,
    snapshotStore: opts.snapshotStore,
    config: opts.config ?? null,
    requestClient: opts.requestClient ?? globalThis.fetch,
    logTransition,
    registry: new ChatAppActorRegistry(),
  };

  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  for (const [path, wireMachine] of WIRE_PATHS) {
    app.route(path, buildChatAppRouter(runtime, wireMachine));
  }
  return app;
}

/**
 * Build the project-context + session-chat resolver actors from env config. The
 * onboarding child needs NO construction deps — its WorkOS/backend URLs + fetch
 * port arrive per-instance on the begin envelope. These two children inject their
 * I/O ports as construction-time actors (ADR-044 §1); ui-state acts on behalf of
 * a flow's principal via the identity headers below (dev user in AUTH_MODE=dev;
 * a service M2M token in production).
 */
function buildChatAppDeps(config: Config): ChatAppDeps {
  const backendUrl = config.backendUrl;
  const headers = config.devUserHeadersFixture;
  return {
    projectContext: {
      resolveInitialScope: resolveInitialScopeActor(backendUrl, headers),
      createProject: createProjectActor(backendUrl, headers),
      switchProject: switchProjectActor(backendUrl, headers),
    },
    sessionChat: {
      loadSessionList: loadSessionListActor(backendUrl, headers),
      resumeSession: resumeSessionActor(backendUrl, headers),
      createSessionEagerly: createSessionEagerlyActor(backendUrl, headers),
      switchDatasetContext: switchDatasetContextActor(backendUrl, headers),
    },
  };
}

/**
 * Production entry point: validate the environment (`loadConfig` throws at
 * startup if a required var is missing) and build the app with real stores +
 * resolver actors. The onboarding I/O port relies on the `globalThis.fetch`
 * default, so no extra wiring is needed.
 */
function buildProductionApp(): {
  app: Hono;
  eventLog: FlowEventLog;
  snapshotStore: ChatAppSnapshotStore;
} {
  const config = loadConfig();
  const eventLog = selectFlowEventLog(config.redisUrl);
  const snapshotStore = selectChatAppSnapshotStore(config.redisUrl);
  const app = buildChatAppApp({
    eventLog,
    snapshotStore,
    chatAppDeps: buildChatAppDeps(config),
    config,
  });
  return { app, eventLog, snapshotStore };
}

const autostart = process.env.UI_STATE_AUTOSTART !== "false";

// In autostart (production) mode build the real app once + probe its stores; in
// test mode (UI_STATE_AUTOSTART=false) export an inert app — the tests build
// their own scenario-scoped app via buildChatAppApp.
const production = autostart
  ? buildProductionApp()
  : { app: new Hono(), eventLog: null, snapshotStore: null };

const app = production.app;

if (autostart && production.eventLog && production.snapshotStore) {
  const { eventLog, snapshotStore } = production;
  // Probe both backing stores early so the container hard-fails per ADR-030 §SD3
  // if REDIS_URL is set but a store cannot round-trip.
  Promise.all([eventLog.probe(), snapshotStore.probe()])
    .then(() => {
      const port = parseInt(process.env.PORT ?? "8788", 10);
      serve({ fetch: app.fetch, port });
      process.stdout.write(
        `${JSON.stringify({ event: "flow.startup", port })}\n`,
      );
    })
    .catch((err) => {
      process.stderr.write(
        `${JSON.stringify({
          event: "flow.startup.fatal",
          error: (err as Error).message,
        })}\n`,
      );
      process.exit(1);
    });
}

export { app };
