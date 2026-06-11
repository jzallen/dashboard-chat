// UI-State Tier — Hono server entry point.
//
// The live ui-state app is driven by the ChatApp coordinator actor (one per
// principal), published through a SINGLE `/state` actor surface
// (lib/machines/chat-app/router.ts → buildStateRouter) that emits ONE whole-actor
// `ChatAppStateDocument` derived from the per-principal snapshot
// (deriveStateDocument):
//
//   GET  /state          → the whole-actor ChatAppStateDocument (.getSnapshot)
//   POST /state/events    → apply ONE event, return the new document (.send)
//   GET  /state/stream    → SSE; the document pushed on every change (.subscribe)
//   GET  /health
//
// The per-machine `/flow/<wire>/{projection,event,begin,open-deep-link,…}`
// surface (the frozen ADR-027 wire + its alias map) was RETIRED at ADR-046 MR-7
// once every consumer moved to `/state`.
//
// Persistence is a hybrid: the live actor is the state-of-record
// (getPersistedSnapshot via ChatAppSnapshotStore, hot-restart recovery); the
// append-only FlowEventLog serves SSE/audit + projection bookkeeping. There is
// NO /freeze + /thaw — auth-proxy owns the token lifecycle.
//
// Auth: this tier trusts the X-User-Id / X-Org-Id / X-User-Email headers injected
// by auth-proxy upstream. It does NOT re-verify JWTs except the onboarding
// child's re-verify of the forwarded Bearer against WorkOS.
//
// References:
//   docs/decisions/adr-016-*.md  — auth-proxy owns token lifecycle, injects identity headers
//   docs/decisions/adr-046-*.md  — StateProxy /state actor surface (MR-7 retires per-machine)
//   docs/decisions/adr-030-*.md  — flow_id key form / single-replica startup probe
//   docs/decisions/adr-041-*.md  — session-onboarding domain realignment
//   docs/decisions/adr-044-*.md  — hybrid snapshot/log persistence, derived projection, I/O ports as actors

import { serve } from "@hono/node-server";
import { Hono } from "hono";

import { type Config, loadConfig } from "./config.ts";
import type { ChatAppDeps } from "./lib/machines/chat-app/index.ts";
import {
  buildStateRouter,
  ChatAppActorRegistry,
  type ChatAppRuntime,
} from "./lib/machines/chat-app/router.ts";
import type { RequestClient } from "./lib/machines/onboarding/index.ts";
import {
  type ChatAppSnapshotStore,
  selectChatAppSnapshotStore,
} from "./lib/persistence/chatapp-snapshot-store.ts";
import { type FlowEventLog, selectFlowEventLog } from "./lib/persistence/redis.ts";

/**
 * Compose the live ChatApp-backed app onto a fresh Hono instance. This is the
 * composition seam: production calls it with the real stores + empty child deps
 * (zero egress — every child is report-driven); the in-process tests inject a
 * noop event-log + noop snapshot store + empty child deps.
 */
export function buildChatAppApp(opts: {
  eventLog: FlowEventLog;
  snapshotStore: ChatAppSnapshotStore;
  /** The child construction deps. Both surfaces are empty under the zero-egress
   *  report-driven model (CDO-S5); retained for shape stability. */
  chatAppDeps: ChatAppDeps;
  /** Redis-only env config (CDO-S5). Threaded into the runtime for shape
   *  stability; the report-driven children read nothing from it. */
  config?: Config | null;
  /** INERT I/O-port slot (zero egress, CDO-S5). Defaults to globalThis.fetch but
   *  no resolver calls it — the report-driven children make no backend round-trips. */
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
  // ADR-046: the single `/state` actor surface is the SOLE read/write surface
  // (the per-machine `/flow/<wire>` mounts were retired at MR-7).
  app.route("/", buildStateRouter(runtime));
  return app;
}

/**
 * Build the child construction-deps. ZERO EGRESS (CDO-S5 / ADR-048 §4): every
 * child is now report-driven, so NONE inject a server-side resolver actor —
 * project-context's egress resolvers (resolveInitialScope/createProject/
 * switchProject) were deleted at step 05-02 and session-chat's at step 05-01.
 * Both deps surfaces are empty; the machines transition on client-reported
 * outcomes (no backend round-trips).
 */
function buildChatAppDeps(): ChatAppDeps {
  return {
    // Report-driven project-context (ADR-049 §4) + session-chat (ADR-050 §e.5)
    // invoke NO actors — no egress resolvers are wired here.
    projectContext: {},
    sessionChat: {},
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
  const eventLog = selectFlowEventLog(config.redisUrl, config.flowTtlSeconds);
  const snapshotStore = selectChatAppSnapshotStore(
    config.redisUrl,
    config.flowTtlSeconds,
  );
  const app = buildChatAppApp({
    eventLog,
    snapshotStore,
    chatAppDeps: buildChatAppDeps(),
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
  // Probe both backing stores early so the container hard-fails
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
