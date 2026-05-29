// ChatApp HTTP transport — the LIVE wire surface for the ui-state tier
// (ADR-044 Phase 4). This is the declarative successor to the per-machine
// orchestrator routers: ONE ChatApp actor per principal serves ALL THREE wire
// machines' projections (login-and-org-setup / project-and-chat-session-management
// / session-chat) as DERIVED VIEWS of the single coordinator actor.
//
// Why one router factory, mounted under five wire paths:
//   - The live FE + auth-proxy READ all three machines' projections (the frozen
//     ADR-027 wire contract). Each mount bakes its own `wireMachineName`, so
//     `deriveProjection(snapshot, wireMachineName, …)` synthesizes the right
//     `flow_id` + child slice (the alias names resolve via WIRE_TO_CHILD).
//   - WRITES (`/begin`, `/event`, `/open-deep-link`) all target the SAME
//     per-principal ChatApp actor: cold-start bootstraps onboarding; the parent
//     cascades to project-context + session-chat internally (ADR-028 onSnapshot
//     hand-offs) — no separate project/session begin is needed.
//
// Persistence (ADR-044 §2 hybrid): the live ChatApp actor is the STATE-of-record
// (getPersistedSnapshot via ChatAppSnapshotStore, for hot restart recovery). The
// append-only FlowEventLog is RETAINED but DEMOTED to SSE/audit + projection
// bookkeeping (sequence_id/last_event_at/request_id) — keyed by the CANONICAL
// child so the alias paths share one log and report consistent bookkeeping.
//
// No `/freeze` + `/thaw`: ChatApp's connectivity/freeze region was retired
// (ADR-043 / ADR-044 amendment 2026-05-28); auth-proxy owns the token lifecycle
// (ADR-016), so ui-state is never a token-management participant.

import { KNOB, shouldInject } from "@dashboard-chat/shared-failure-simulation";
import { type Context, Hono } from "hono";
import { type AnyActorRef, createActor } from "xstate";
import { z } from "zod";

import type { Config } from "../../../config.ts";
import { resolveActiveScope, type ResourceType } from "../../domain/active-scope.ts";
import { FlowEvent } from "../../domain/flow-event.ts";
import type { FlowProjection } from "../../domain/flow-projection.ts";
import { requestIdMiddleware } from "../../hexagonal-transport/flow-router.ts";
import type { FlowEventLog } from "../../persistence/redis.ts";
import type { ChatAppSnapshotStore } from "../../persistence/chatapp-snapshot-store.ts";
import type { RequestClient } from "../session-onboarding/index.ts";
import { isUnderlyingCauseTag } from "../session-onboarding/setup/domain.ts";
import { createChatApp, type ChatAppDeps } from "./index.ts";
import {
  bookkeepingFromLog,
  type ChatAppSnapshotView,
  childIdForWireMachine,
  deriveProjection,
  type ProjectionBookkeeping,
} from "./projection/derive-projection.ts";
import {
  isSettledForSnapshot,
  loadChatAppSnapshot,
  rehydrateChatApp,
  saveChatAppSnapshot,
} from "./snapshot.ts";
import type { ChatAppChildId, SessionOnboardingInput } from "./setup/types.ts";

/** The canonical child ids whose per-flow bookkeeping logs a principal owns. A
 *  `force_restart` begin resets all three so a fresh flow inherits no stale
 *  bookkeeping. */
const CANONICAL_CHILDREN: readonly ChatAppChildId[] = [
  "session-onboarding",
  "project-context",
  "session-chat",
];

/** Bounded settle timeout — the longest a write handler awaits the actor's
 *  invoke cascade before reading the projection (defensive cap mirroring the
 *  retired waitForSettledState; on timeout the projection reflects whatever
 *  state the actor reached). */
const SETTLE_TIMEOUT_MS = 10_000;

// ───────────────────────── per-principal actor registry ─────────────────────────

/**
 * Per-principal ChatApp actor map. ui-state is single-replica (ADR-030 §SD2 —
 * XState v5 actors are in-process), so an in-memory map is the live actor store;
 * the ChatAppSnapshotStore backs hot-restart recovery across process restarts.
 */
export class ChatAppActorRegistry {
  private readonly actors = new Map<string, AnyActorRef>();

  get(principal_id: string): AnyActorRef | undefined {
    return this.actors.get(principal_id);
  }

  set(principal_id: string, actor: AnyActorRef): void {
    this.actors.set(principal_id, actor);
  }

  /** Stop + forget a principal's actor (begin force_restart). */
  recycle(principal_id: string): void {
    const existing = this.actors.get(principal_id);
    if (existing) {
      existing.stop();
      this.actors.delete(principal_id);
    }
  }

  dispose(): void {
    for (const actor of this.actors.values()) actor.stop();
    this.actors.clear();
  }
}

// ───────────────────────────── runtime (shared deps) ─────────────────────────────

/** Everything the wire routers need, built once at the composition root and
 *  shared across all five wire-path mounts (one actor store, one event log, one
 *  snapshot store, one set of child resolver actors). */
export interface ChatAppRuntime {
  chatAppDeps: ChatAppDeps;
  eventLog: FlowEventLog;
  snapshotStore: ChatAppSnapshotStore;
  /** Onboarding child resolver config (WorkOS/backend URLs). Null in tests that
   *  stub the onboarding I/O via the injected requestClient. */
  config: Config | null;
  /** The fetch I/O port the onboarding child's resolvers call. */
  requestClient: RequestClient;
  logTransition: (record: Record<string, unknown>) => void;
  registry: ChatAppActorRegistry;
}

/** Cold-start (or force-restart) a principal's ChatApp actor from the begin
 *  envelope: dispose any prior actor, drop its snapshot + bookkeeping logs, then
 *  create + start a fresh wired actor bootstrapped into onboarding. */
async function coldStart(
  runtime: ChatAppRuntime,
  principal_id: string,
  bearer_token: string,
  request_id: string,
): Promise<AnyActorRef> {
  runtime.registry.recycle(principal_id);
  await runtime.snapshotStore.reset(principal_id);
  await Promise.all(
    CANONICAL_CHILDREN.map((child) =>
      runtime.eventLog.reset(`${child}:${principal_id}`),
    ),
  );

  const input: SessionOnboardingInput = {
    request_id,
    principal_id,
    bearer_token,
    config: runtime.config,
    deps: { request_client: runtime.requestClient },
  };
  const actor = createActor(createChatApp(runtime.chatAppDeps), { input }).start();
  runtime.registry.set(principal_id, actor);
  return actor;
}

/** Look up a principal's live actor, rehydrating from the snapshot store on a
 *  cold process if one was persisted (R3 self-heal). Returns undefined when no
 *  flow exists for the principal — the caller then derives the anonymous view. */
async function getActor(
  runtime: ChatAppRuntime,
  principal_id: string,
): Promise<AnyActorRef | undefined> {
  const live = runtime.registry.get(principal_id);
  if (live) return live;
  const snapshot = await loadChatAppSnapshot(runtime.snapshotStore, principal_id);
  if (!snapshot) return undefined;
  const actor = rehydrateChatApp(createChatApp(runtime.chatAppDeps), snapshot);
  runtime.registry.set(principal_id, actor);
  return actor;
}

/** Await the actor's invoke cascade quiescing (no child mid-invoke), bounded by
 *  SETTLE_TIMEOUT_MS. The settled predicate is the SAME R3 guard the snapshot
 *  store uses, so "safe to read" == "safe to persist". */
function settle(actor: AnyActorRef): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    const tick = (): void => {
      let settled: boolean;
      try {
        settled = isSettledForSnapshot(
          actor.getSnapshot() as unknown as Parameters<
            typeof isSettledForSnapshot
          >[0],
        );
      } catch {
        settled = true;
      }
      if (settled || Date.now() >= deadline) return resolve();
      setTimeout(tick, 2);
    };
    // Defer one turn so a synchronous invoke entry surfaces before the first poll.
    setTimeout(tick, 0);
  });
}

/** Persist the principal's snapshot — a no-op unless the actor is settled (R3).
 *  Never throws into the request path. */
async function persist(
  runtime: ChatAppRuntime,
  principal_id: string,
  actor: AnyActorRef,
): Promise<void> {
  try {
    await saveChatAppSnapshot(
      runtime.snapshotStore,
      principal_id,
      actor as unknown as Parameters<typeof saveChatAppSnapshot>[2],
    );
  } catch {
    // Persistence is best-effort (ADR-044 §2 — the live actor is the truth; a
    // missed save only forfeits hot-restart recovery, never the live response).
  }
}

/** Append a bookkeeping marker to the canonical child's RETAINED log so the
 *  derived projection's sequence_id/last_event_at/request_id stay monotonic for
 *  SSE/audit. Best-effort (a missed append only delays an SSE push, ADR-044 §2). */
async function appendBookkeeping(
  runtime: ChatAppRuntime,
  wireMachine: string,
  principal_id: string,
  request_id: string,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const child = childIdForWireMachine(wireMachine);
  if (!child) return;
  const flowKey = `${child}:${principal_id}`;
  try {
    await runtime.eventLog.append(
      flowKey,
      FlowEvent.createForFlow(flowKey, { type, payload, request_id }),
    );
  } catch {
    // best-effort
  }
}

async function readBookkeeping(
  runtime: ChatAppRuntime,
  wireMachine: string,
  principal_id: string,
): Promise<ProjectionBookkeeping> {
  const child = childIdForWireMachine(wireMachine);
  const events = child
    ? await runtime.eventLog.read(`${child}:${principal_id}`)
    : [];
  return bookkeepingFromLog(events);
}

// ───────────────────────────── snapshot views ─────────────────────────────

function viewOf(actor: AnyActorRef): ChatAppSnapshotView {
  return actor.getSnapshot() as unknown as ChatAppSnapshotView;
}

/** The anonymous view for a principal with no flow — folds to the zero-event
 *  projection (state `verifying`, initialContext) for every wire machine, exactly
 *  as `buildProjection([])` did on the orchestrator path, but derived purely
 *  through the mapper (no log-fold on the live read path). */
function emptyView(principal_id: string): ChatAppSnapshotView {
  return {
    value: "onboarding",
    context: { principal_id, onboarding_result: null },
    children: {},
  };
}

async function projectionResponse(
  c: Context,
  runtime: ChatAppRuntime,
  wireMachine: string,
  principal_id: string,
): Promise<Response> {
  const actor = await getActor(runtime, principal_id);
  const bookkeeping = await readBookkeeping(runtime, wireMachine, principal_id);
  const view = actor ? viewOf(actor) : emptyView(principal_id);
  const projection: FlowProjection = deriveProjection(view, wireMachine, bookkeeping);
  return c.json(projection);
}

// ───────────────────────── onboarding /event ACL schema ─────────────────────────
// Preserved verbatim from the retired session-onboarding router: the onboarding
// wire's /event vocabulary is CLOSED (an unmodeled type → 400) and each arm
// validates only payload WELL-FORMEDNESS (org_name string-ness; a known cause
// tag). Domain rules (is the org name valid?) stay on the value object.

const causeTag = z.string().refine(isUnderlyingCauseTag, {
  message: "tag must be a known UnderlyingCauseTag",
});

const onboardingEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("org_form_submitted"),
    payload: z.object({ org_name: z.string() }).passthrough(),
  }),
  z.object({
    type: z.literal("__force_failure__"),
    payload: z.object({ tag: causeTag }).passthrough(),
  }),
]);

// ───────────────────────────── the router factory ─────────────────────────────

/**
 * Build a wire router for ONE machine name, sharing the runtime's per-principal
 * actor store. The caller mounts the result at `/flow/{wireMachine}` (and any
 * alias path). `wireMachine` selects the child slice + flow_id for every read
 * and the bookkeeping log key for every write.
 */
export function buildChatAppRouter(
  runtime: ChatAppRuntime,
  wireMachine: string,
): Hono {
  const router = new Hono();
  router.use("*", requestIdMiddleware);

  const isOnboardingWire = childIdForWireMachine(wireMachine) === "session-onboarding";

  // POST /begin — cold-start the principal's ChatApp actor (onboarding entry).
  // Always (re)starts: the begin envelope re-verifies the forwarded Bearer and
  // the parent cascades onboarding → project-context → chat internally. The
  // response is THIS wire machine's derived projection.
  router.post("/begin", async (c) => {
    const request_id = c.get("requestId");
    // Body carries only org-setup hints (audit); identity is header-trusted (L4).
    try {
      if (c.req.method !== "GET") await c.req.json();
    } catch {
      // body-less / malformed → ignored; identity is from headers.
    }
    const principal_id = c.req.header("X-User-Id") ?? "";
    const bearer = readBearerToken(c);

    runtime.logTransition({
      event: "session_onboarding.org_claim",
      request_id,
      principal_id,
      claimed_org_id: c.req.header("X-Org-Id") || null,
    });

    const actor = await coldStart(runtime, principal_id, bearer, request_id);
    await settle(actor);
    await persist(runtime, principal_id, actor);
    await appendBookkeeping(runtime, wireMachine, principal_id, request_id, "session_begin");

    return projectionResponse(c, runtime, wireMachine, principal_id);
  });

  // POST /event — forward ONE event to the principal's OWN ChatApp actor. The
  // onboarding wire enforces its CLOSED vocabulary at this ACL; other wires take
  // the project/session child event surface and forward it verbatim to the active
  // child. `switching_project_intent` maps to the parent's PROJECT_SWITCH so it
  // reaches project-context even while chat is the active child.
  router.post("/event", async (c) => {
    const request_id = c.get("requestId");

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const principal_id = c.req.header("X-User-Id") ?? "";

    let type: string;
    let payload: Record<string, unknown>;

    if (isOnboardingWire) {
      const parsed = onboardingEventSchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(
          { error: "invalid_request", issues: parsed.error.issues },
          400,
        );
      }
      type = parsed.data.type;
      payload = parsed.data.payload;
    } else {
      const body = rawBody as { type?: string; payload?: Record<string, unknown> };
      if (!body || typeof body.type !== "string") {
        return c.json({ error: "invalid_request" }, 400);
      }
      type = body.type;
      payload = body.payload ?? {};
    }

    runtime.logTransition({
      event: isOnboardingWire
        ? "session_onboarding.event_received"
        : "chat_app.event_received",
      request_id,
      principal_id: principal_id || null,
      flow_id: `${wireMachine}:${principal_id}`,
      event_type: type,
    });

    // ADR-035 failure-simulation AUTHORIZATION gate — a policy check kept distinct
    // from shape validation: production cannot drive the forced-failure
    // side-channel even with a well-formed event.
    if (
      type === "__force_failure__" &&
      !shouldInject(KNOB.forceFailureOnAuthRetry, {
        event: { type },
        correlationId: request_id,
        serviceName: "ui-state",
      })
    ) {
      return c.json(
        {
          error:
            "failure-simulation knob disabled: __force_failure__ requires the gate enabled (ENVIRONMENT=dev|ci + flag set)",
        },
        403,
      );
    }

    const actor = await getActor(runtime, principal_id);
    if (actor) {
      forwardToActor(actor, type, payload);
      await settle(actor);
      await persist(runtime, principal_id, actor);
      await appendBookkeeping(runtime, wireMachine, principal_id, request_id, type, payload);
    }

    return projectionResponse(c, runtime, wireMachine, principal_id);
  });

  // POST /open-deep-link — the J-002 intent-shaped deep link (US-204 / DWD-9):
  // forward `open_deep_link` to the project-context child, which re-enters
  // resolving_initial_scope and absorbs the deeplink target into its context so
  // the derived projection reflects it. The legacy route-shaped branch
  // (resolveActiveScope at the HTTP edge) appends an audit event; the derived
  // view sources scope from child context, so route-shaped scope is
  // acceptance-only (ADR-044 §gap #6).
  router.post("/open-deep-link", async (c) => {
    const request_id = c.get("requestId");
    let body: {
      route?: {
        org?: string;
        project?: string;
        resource_type?: ResourceType;
        resource_id?: string;
      };
      project_name?: string;
      bookmarked_project_name?: string;
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
    const principal_id = c.req.header("X-User-Id") ?? "";

    const isIntentShaped =
      body.intent_project_id !== undefined ||
      body.intent_session_id !== undefined ||
      body.intent_resource_id !== undefined;

    const actor = await getActor(runtime, principal_id);

    if (isIntentShaped) {
      if (actor) {
        const payload: Record<string, unknown> = {};
        if (body.intent_project_id !== undefined)
          payload.intent_project_id = body.intent_project_id;
        if (body.intent_session_id !== undefined)
          payload.intent_session_id = body.intent_session_id;
        if (body.intent_resource_id !== undefined)
          payload.intent_resource_id = body.intent_resource_id;
        if (body.intent_resource_type !== undefined)
          payload.intent_resource_type = body.intent_resource_type;
        forwardToActor(actor, "open_deep_link", payload);
        await settle(actor);
        await persist(runtime, principal_id, actor);
        await appendBookkeeping(
          runtime,
          wireMachine,
          principal_id,
          request_id,
          "open_deep_link",
          payload,
        );
      }
      return projectionResponse(c, runtime, wireMachine, principal_id);
    }

    // Legacy route-shaped (acceptance/dev): resolve scope at the edge + record an
    // audit event. The derived view does not fold these, so state is unchanged.
    const orgId = c.req.header("X-Org-Id") ?? null;
    const route = body.route ?? {};
    const resolution = resolveActiveScope(
      route,
      { sub: principal_id, org_id: orgId },
      {
        bookmarked_project_name: body.bookmarked_project_name ?? null,
        current_project_name: body.project_name ?? null,
      },
    );
    await appendBookkeeping(
      runtime,
      wireMachine,
      principal_id,
      request_id,
      resolution.ok ? "deep_link_opened" : "scope_access_denied",
      resolution.ok ? { scope: resolution.scope } : { reason: "cross-tenant access" },
    );
    return projectionResponse(c, runtime, wireMachine, principal_id);
  });

  // GET /projection — the frozen ADR-027 read contract, derived byte-stable from
  // the principal's ChatApp snapshot for this wire machine.
  router.get("/projection", async (c) => {
    const principal_id = c.req.header("X-User-Id") ?? "";
    return projectionResponse(c, runtime, wireMachine, principal_id);
  });

  // GET /projection/stream — SSE substrate (DWD-9 / RD2). First frame is the
  // current derived projection; each subsequent retained-log event triggers a
  // fresh derive. Bounded by a server-side budget so intermediaries don't trip.
  router.get("/projection/stream", async (c) => {
    const principal_id = c.req.header("X-User-Id") ?? "";
    const sinceParam = c.req.query("since") ?? "$";
    const budgetMs = Math.min(
      Math.max(parseInt(c.req.query("budget_ms") ?? "25000", 10) || 25_000, 1_000),
      60_000,
    );
    const child = childIdForWireMachine(wireMachine);
    const flowKey = child ? `${child}:${principal_id}` : `${wireMachine}:${principal_id}`;

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
        const derive = async (): Promise<FlowProjection> => {
          const actor = await getActor(runtime, principal_id);
          const bookkeeping = await readBookkeeping(runtime, wireMachine, principal_id);
          const view = actor ? viewOf(actor) : emptyView(principal_id);
          return deriveProjection(view, wireMachine, bookkeeping);
        };
        try {
          writeEvent("projection", await derive());
          for await (const _event of runtime.eventLog.subscribe(
            flowKey,
            sinceParam,
            budgetMs,
          )) {
            writeEvent("projection", await derive());
          }
        } catch (err) {
          writeEvent("error", { message: (err as Error).message });
        } finally {
          try {
            controller.close();
          } catch {
            // client may have closed already
          }
        }
      },
    });

    return new Response(stream, { headers, status: 200 });
  });

  return router;
}

/** Forward a raw domain event to the ChatApp actor. `switching_project_intent`
 *  is the project SWITCH — it routes via the parent's PROJECT_SWITCH so it reaches
 *  project-context even when session-chat is the active child; everything else is
 *  a `child_event` the parent forwards to the active child verbatim. */
function forwardToActor(
  actor: AnyActorRef,
  type: string,
  payload: Record<string, unknown>,
): void {
  if (type === "switching_project_intent") {
    actor.send({
      type: "PROJECT_SWITCH",
      new_project_id: String(payload.new_project_id ?? ""),
    });
    return;
  }
  actor.send({ type: "child_event", child_event: { type, payload } });
}

/** Extract the forwarded Bearer (L4) from the Authorization header; "" when
 *  absent (the onboarding re-verify then fails → session_rejected). */
function readBearerToken(c: Context): string {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? "";
}
