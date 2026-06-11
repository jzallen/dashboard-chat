// ChatApp HTTP transport — the LIVE `/state` actor surface for the ui-state
// tier. ONE ChatApp actor per principal is published through a single `/state`
// surface that bridges XState's ActorRef primitives to HTTP (ADR-046):
//   .getSnapshot() → GET  /state          — the whole-actor ChatAppStateDocument
//   .send(event)   → POST /state/events    — apply ONE event, return the new document
//   .subscribe()   → GET  /state/stream    — SSE; the document, pushed on every change
//
// The per-machine `/flow/<wire>/{projection,event,begin,open-deep-link}` surface
// (the frozen ADR-027 wire contract + its alias map) was RETIRED at ADR-046 MR-7
// once every consumer (FE, auth-proxy, acceptance) moved to `/state`. `/state` is
// now the sole read path; the whole-actor mapper (`deriveStateDocument`) is the
// sole projection.
//
// Persistence (hybrid): the live ChatApp actor is the STATE-of-record
// (getPersistedSnapshot via ChatAppSnapshotStore, for hot restart recovery). The
// append-only FlowEventLog carries SSE/audit + projection bookkeeping
// (sequence_id/last_event_at/request_id) — aggregated over the three canonical
// child logs into the document's single hoisted counter.
//
// No `/freeze` + `/thaw`: auth-proxy owns the token lifecycle, so ui-state is
// never a token-management participant.
//
// References:
//   docs/decisions/adr-046-*.md  — StateProxy /state actor surface (MR-7 retires per-machine)
//   docs/decisions/adr-044-*.md  — hybrid log/derived-view projection
//   docs/decisions/adr-028-*.md  — parent-ignorant children, onSnapshot hand-offs
//   docs/decisions/adr-030-*.md  — single-replica in-process actors
//   docs/decisions/adr-035-*.md  — failure-simulation authorization gate
//   docs/decisions/adr-016-*.md  — auth-proxy owns the token lifecycle

import { KNOB, shouldInject } from "@dashboard-chat/shared-failure-simulation";
import { type Context, Hono } from "hono";
import { type AnyActorRef, createActor } from "xstate";
import { z } from "zod";

import type { Config } from "../../../config.ts";
import { FlowEvent } from "../../domain/flow-event.ts";
import { requestIdMiddleware } from "../../hexagonal-transport/flow-router.ts";
import type { FlowEventLog } from "../../persistence/redis.ts";
import type { ChatAppSnapshotStore } from "../../persistence/chatapp-snapshot-store.ts";
import type { RequestClient } from "../onboarding/index.ts";
import { isUnderlyingCauseTag } from "../onboarding/setup/domain.ts";
import { createChatApp, type ChatAppDeps } from "./index.ts";
import {
  aggregateBookkeeping,
  bookkeepingFromLog,
  type ChatAppPhase,
  type ChatAppSnapshotView,
  type ChatAppStateDocument,
  derivePhase,
  deriveStateDocument,
  type ProjectionBookkeeping,
} from "./projection/derive-state-document.ts";
import {
  isSettledForSnapshot,
  loadChatAppSnapshot,
  rehydrateChatApp,
  saveChatAppSnapshot,
} from "./snapshot.ts";
import type { ChatAppChildId, OnboardingInput } from "./setup/types.ts";

/** The canonical child ids whose per-flow bookkeeping logs a principal owns. A
 *  `force_restart` begin resets all three so a fresh flow inherits no stale
 *  bookkeeping. */
const CANONICAL_CHILDREN: readonly ChatAppChildId[] = [
  "onboarding",
  "project-context",
  "session-chat",
];

/** Bounded settle timeout — the longest a write handler awaits the actor's
 *  invoke cascade before reading the projection (defensive cap; on timeout the
 *  projection reflects whatever state the actor reached). */
const SETTLE_TIMEOUT_MS = 10_000;

// ───────────────────────── per-principal actor registry ─────────────────────────

/**
 * Per-principal ChatApp actor map. ui-state is single-replica (XState v5 actors
 * are in-process), so an in-memory map is the live actor store; the
 * ChatAppSnapshotStore backs hot-restart recovery across process restarts.
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
  user_email: string | null,
): Promise<AnyActorRef> {
  runtime.registry.recycle(principal_id);
  await runtime.snapshotStore.reset(principal_id);
  await Promise.all(
    CANONICAL_CHILDREN.map((child) =>
      runtime.eventLog.reset(`${child}:${principal_id}`),
    ),
  );

  const input: OnboardingInput = {
    request_id,
    principal_id,
    bearer_token,
    config: runtime.config,
    deps: { request_client: runtime.requestClient },
    // Identity seed from the auth-proxy-verified X-User-Email header (DR-4 /
    // INV-PCO): the SINGLE writer of the onboarding child's context.user.
    // display_name/first_name stay null (auth-proxy injects no such header).
    user: { email: user_email, display_name: null, first_name: null },
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
    // Persistence is best-effort — the live actor is the truth; a missed save
    // only forfeits hot-restart recovery, never the live response.
  }
}

// ───────────────────────────── snapshot views ─────────────────────────────

function viewOf(actor: AnyActorRef): ChatAppSnapshotView {
  return actor.getSnapshot() as unknown as ChatAppSnapshotView;
}

/** The anonymous view for a principal with no flow — folds to the zero-event
 *  projection (state `verifying`, initialContext) for every wire machine, exactly
 *  as `buildProjection([])` yields, but derived purely through the mapper (no
 *  log-fold on the live read path). */
function emptyView(principal_id: string): ChatAppSnapshotView {
  return {
    value: "login",
    context: { principal_id, onboarding_result: null },
    children: {},
  };
}

// ───────────────────────── onboarding event ACL schema ─────────────────────────
// The onboarding wire's /event vocabulary is CLOSED (an unmodeled type → 400)
// and each arm validates only payload WELL-FORMEDNESS (org_name string-ness; a
// known cause tag). Domain rules (is the org name valid?) stay on the value
// object.

const causeTag = z.string().refine(isUnderlyingCauseTag, {
  message: "tag must be a known UnderlyingCauseTag",
});

/** The {id,name} display snapshot a client-reported org outcome carries
 *  (ADR-050 §e.1). Well-formedness only — the org's existence is the client's
 *  earned-trust assertion, never re-probed here (INV-PCO). */
const orgSnapshot = z.object({ id: z.string(), name: z.string() }).passthrough();

const onboardingEventSchema = z.discriminatedUnion("type", [
  // ── client-reported outcomes (ADR-049/050) ──
  z.object({
    type: z.literal("org_found"),
    payload: z.object({ org: orgSnapshot }).passthrough(),
  }),
  z.object({
    type: z.literal("org_not_found"),
    payload: z.object({}).passthrough(),
  }),
  z.object({
    type: z.literal("org_created"),
    payload: z.object({ org: orgSnapshot }).passthrough(),
  }),
  // ── legacy org-form submit (retires CDO-S3) ──
  z.object({
    type: z.literal("org_form_submitted"),
    payload: z.object({ org_name: z.string() }).passthrough(),
  }),
  z.object({
    type: z.literal("__force_failure__"),
    payload: z.object({ tag: causeTag }).passthrough(),
  }),
]);

// ═════════════════════════════ the /state actor surface (ADR-046) ═════════════════════════════
//
// ONE honest surface over the per-principal ChatApp actor, bridging XState's
// ActorRef primitives to HTTP (ADR-046 Decision-table):
//   .getSnapshot() → GET  /state          — the whole-actor ChatAppStateDocument
//   .send(event)   → POST /state/events    — apply ONE event, return the new document
//   .subscribe()   → GET  /state/stream    — SSE; the document, pushed on every change
//
// This is the SOLE read/write surface (the per-machine `/flow/<wire>` mounts were
// retired at MR-7). It reuses the ChatAppRuntime (one registry / event log /
// snapshot store / child resolvers) and the helpers below (getActor / coldStart /
// settle / persist / emptyView / onboardingEventSchema / forwardToActor / the
// failure-sim gate). The whole-actor mapper (deriveStateDocument) is the sole
// projection.

/** Aggregate the document's single hoisted bookkeeping triple over the THREE
 *  canonical child logs (ADR-046 Decision 4 — one actor ⇒ one authoritative
 *  counter). */
async function readStateBookkeeping(
  runtime: ChatAppRuntime,
  principal_id: string,
): Promise<ProjectionBookkeeping> {
  const parts = await Promise.all(
    CANONICAL_CHILDREN.map(async (child) =>
      bookkeepingFromLog(await runtime.eventLog.read(`${child}:${principal_id}`)),
    ),
  );
  return aggregateBookkeeping(parts);
}

/** Derive the whole-actor document for a principal. A principal with no live or
 *  persisted actor folds to the anonymous document (emptyView) — GET /state does
 *  NOT cold-start (Decision 3a). */
async function deriveStateFor(
  runtime: ChatAppRuntime,
  principal_id: string,
): Promise<ChatAppStateDocument> {
  const actor = await getActor(runtime, principal_id);
  const bookkeeping = await readStateBookkeeping(runtime, principal_id);
  const view = actor ? viewOf(actor) : emptyView(principal_id);
  return deriveStateDocument(view, bookkeeping);
}

async function stateDocumentResponse(
  c: Context,
  runtime: ChatAppRuntime,
  principal_id: string,
): Promise<Response> {
  return c.json(await deriveStateFor(runtime, principal_id));
}

/** The canonical child log whose bookkeeping a transition in `phase` advances —
 *  so /state's single sequence_id moves and the union SSE fires for that region. */
function canonicalChildForPhase(phase: ChatAppPhase): ChatAppChildId {
  switch (phase) {
    case "project_context":
      return "project-context";
    case "chat":
      return "session-chat";
    default:
      return "onboarding"; // onboarding | rejected
  }
}

/** Append a bookkeeping marker to a canonical child's log (best-effort) — keyed
 *  by the canonical child directly (the /state surface has no wire-machine
 *  vocabulary), mirroring appendBookkeeping for the per-machine wire. */
async function appendStateBookkeeping(
  runtime: ChatAppRuntime,
  principal_id: string,
  request_id: string,
  child: ChatAppChildId,
  type: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
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

/** Merge several AsyncIterables into one, yielding events as they arrive from any
 *  source and completing when all sources do. Used to subscribe the /state SSE
 *  across the THREE child bookkeeping logs so any region change pushes a fresh
 *  document (the union-subscribed SSE seam, ADR-046 Decision 4). */
async function* mergeAsyncIterables<T>(
  iterables: AsyncIterable<T>[],
): AsyncGenerator<T> {
  const iterators = iterables.map((it) => it[Symbol.asyncIterator]());
  const advance = (i: number) =>
    iterators[i].next().then((result) => ({ i, result }));
  const pending = new Map(iterators.map((_, i) => [i, advance(i)]));
  while (pending.size > 0) {
    const { i, result } = await Promise.race(pending.values());
    if (result.done) {
      pending.delete(i);
    } else {
      yield result.value;
      pending.set(i, advance(i));
    }
  }
}

/**
 * Build the single `/state` actor surface over the shared runtime. ADDITIVE:
 * mounted alongside the per-machine wire at the composition root; reuses every
 * runtime helper rather than introducing a parallel transport.
 */
export function buildStateRouter(runtime: ChatAppRuntime): Hono {
  const router = new Hono();
  router.use("*", requestIdMiddleware);

  // GET /state — .getSnapshot(): the current whole-actor document. Pre-bootstrap
  // (no live/persisted actor) folds to the anonymous document and does NOT
  // cold-start (Decision 3a).
  router.get("/state", async (c) => {
    const principal_id = c.req.header("X-User-Id") ?? "";
    return stateDocumentResponse(c, runtime, principal_id);
  });

  // POST /state/events — .send(event): apply ONE event, return the new document.
  // Implicit bootstrap (Decision 3a): first contact cold-starts the actor;
  // `session_begin{force_restart}` recycles + cold-starts. The onboarding ACL is
  // dispatched on the active PHASE (not the wire path); the failure-sim gate is
  // preserved verbatim.
  router.post("/state/events", async (c) => {
    const request_id = c.get("requestId");

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }
    const body = rawBody as {
      type?: string;
      payload?: Record<string, unknown>;
    };
    if (!body || typeof body.type !== "string") {
      return c.json({ error: "invalid_request" }, 400);
    }
    const type = body.type;
    const principal_id = c.req.header("X-User-Id") ?? "";
    const bearer = readBearerToken(c);
    // Auth-proxy injects X-User-Email alongside X-User-Id; it is the identity
    // seed the cold-start threads into the onboarding child (DR-4 / INV-PCO).
    const user_email = c.req.header("X-User-Email") ?? null;

    const isSessionBegin = type === "session_begin";
    const forceRestart = isSessionBegin && body.payload?.force_restart === true;

    let actor = await getActor(runtime, principal_id);

    // Implicit bootstrap / deliberate restart: cold-start the actor (the current
    // /begin's only load-bearing effects — re-verify the forwarded Bearer, cascade
    // onboarding → project-context → chat — happen identically here).
    if (!actor || forceRestart) {
      actor = await coldStart(runtime, principal_id, bearer, request_id, user_email);
      await settle(actor);
      await persist(runtime, principal_id, actor);
      await appendStateBookkeeping(
        runtime,
        principal_id,
        request_id,
        canonicalChildForPhase(derivePhase(viewOf(actor))),
        "session_begin",
      );
    }

    // session_begin's whole effect IS the (re)start — nothing further to forward.
    if (isSessionBegin) {
      runtime.logTransition({
        event: "chat_app.session_begin",
        request_id,
        principal_id: principal_id || null,
        force_restart: forceRestart,
      });
      return stateDocumentResponse(c, runtime, principal_id);
    }

    // Phase-dispatched onboarding ACL (Decision 3): while onboarding is the active
    // region, the closed onboarding vocabulary is enforced (unmodeled type → 400);
    // otherwise the event forwards verbatim to the active child.
    const phase = derivePhase(viewOf(actor));
    let evType: string;
    let evPayload: Record<string, unknown>;
    if (phase === "onboarding") {
      const parsed = onboardingEventSchema.safeParse(rawBody);
      if (!parsed.success) {
        return c.json(
          { error: "invalid_request", issues: parsed.error.issues },
          400,
        );
      }
      evType = parsed.data.type;
      evPayload = parsed.data.payload;
    } else {
      evType = type;
      evPayload = body.payload ?? {};
    }

    runtime.logTransition({
      event: "chat_app.event_received",
      request_id,
      principal_id: principal_id || null,
      event_type: evType,
    });

    // Failure-simulation AUTHORIZATION gate — preserved unchanged from the
    // per-machine /event handler (a policy check independent of shape validation).
    if (
      evType === "__force_failure__" &&
      !shouldInject(KNOB.forceFailureOnAuthRetry, {
        event: { type: evType },
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

    forwardToActor(actor, evType, evPayload);
    await settle(actor);
    await persist(runtime, principal_id, actor);
    await appendStateBookkeeping(
      runtime,
      principal_id,
      request_id,
      canonicalChildForPhase(derivePhase(viewOf(actor))),
      evType,
      evPayload,
    );

    return stateDocumentResponse(c, runtime, principal_id);
  });

  // GET /state/stream — .subscribe(): SSE of the whole-actor document. First frame
  // is the current document; each retained event on ANY of the three child logs
  // re-derives + emits a fresh document (the union-subscribed seam).
  router.get("/state/stream", async (c) => {
    const principal_id = c.req.header("X-User-Id") ?? "";
    const sinceParam = c.req.query("since") ?? "$";
    const budgetMs = Math.min(
      Math.max(parseInt(c.req.query("budget_ms") ?? "25000", 10) || 25_000, 1_000),
      60_000,
    );
    const flowKeys = CANONICAL_CHILDREN.map(
      (child) => `${child}:${principal_id}`,
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
          writeEvent("state", await deriveStateFor(runtime, principal_id));
          const merged = mergeAsyncIterables(
            flowKeys.map((key) =>
              runtime.eventLog.subscribe(key, sinceParam, budgetMs),
            ),
          );
          for await (const _event of merged) {
            writeEvent("state", await deriveStateFor(runtime, principal_id));
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
