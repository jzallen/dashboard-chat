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
import type { ChatAppSnapshotStore } from "../../persistence/chatapp-snapshot-store.ts";
import type { FlowEventLog } from "../../persistence/redis.ts";
import type { RequestClient } from "../onboarding/index.ts";
import { isUnderlyingCauseTag } from "../onboarding/setup/domain.ts";
import { type ChatAppDeps,createChatApp } from "./index.ts";
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
import type { ChatAppChildId, OnboardingInput } from "./setup/types.ts";
import {
  isSettledForSnapshot,
  loadChatAppSnapshot,
  rehydrateChatApp,
  saveChatAppSnapshot,
} from "./snapshot.ts";

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
  const actor = createActor(createChatApp(runtime.chatAppDeps), {
    input,
  }).start();
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
  const snapshot = await loadChatAppSnapshot(
    runtime.snapshotStore,
    principal_id,
  );
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

// ───────────────────────── closed wire-event ACL schema (ADR-050 §e.2) ─────────────────────────
// The whole `POST /state/events` vocabulary is CLOSED: a closed
// `z.ZodType<ChatAppWireEvent>` — an unmodeled `type` → 400 IN EVERY PHASE (no
// phase-scoped dispatch). Each arm validates payload WELL-FORMEDNESS only
// (org/project {id,name} string-ness; a known cause enum; a known cause tag for
// the failure side-channel). Domain rules (is the org name valid?) stay on the
// value objects downstream. The legacy kept members (org_form_submitted /
// create_project_submitted / switching_project_intent) are NAMED here so they are
// known-but-unhandled → 200 convergence (NOT 400); they no longer drive a
// transition under the report-driven / phase-gated model.
//
// `ChatAppWireEvent` is the CLOSED wire union — the SSOT lives in
// shared/ui-state-wire/wire-event.ts (ADR-050 §e). Mirrored LOCALLY here (the
// build's node_modules resolves `@dashboard-chat/ui-state-wire` to a pre-CDO-S3
// open-union copy); the local mirror is genuinely closed (no `{type:string}`
// catch-all), so the `z.ZodType<...>` pin keeps the ACL closed at the type level.
type WireIdName = { id: string; name: string };
type ChatAppWireEvent =
  | { type: "org_found"; payload: { org: WireIdName } }
  | { type: "org_not_found"; payload: Record<string, never> }
  | { type: "org_created"; payload: { org: WireIdName } }
  | { type: "scope_resolved"; payload: { project: WireIdName } }
  | { type: "no_projects_found"; payload: Record<string, never> }
  | { type: "project_created"; payload: { project: WireIdName } }
  | { type: "org_form_submitted"; payload: { org_name: string } }
  | { type: "create_project_submitted"; payload: { org_name: string } }
  | { type: "switching_project_intent"; payload: { new_project_id: string } }
  | { type: "__force_failure__"; payload: { tag: string } }
  | {
      type: "open_deep_link";
      payload: {
        intent_project_id?: string;
        intent_session_id?: string;
        intent_resource_id?: string;
        intent_resource_type?: string;
      };
    }
  | { type: "session_begin"; payload?: { force_restart?: boolean } }
  | {
      type: "org_create_failed";
      payload: {
        cause: "org_name_taken" | "org_name_invalid" | "org_create_failed";
        org_name?: string;
      };
    }
  | { type: "project_create_failed"; payload: { cause: "project_create_failed" } }
  | {
      type: "scope_mismatch";
      payload: { cause: "cross_tenant" | "project_not_found" | "access_revoked" };
    }
  | { type: "project_switched"; payload: { project: WireIdName } }
  | { type: "session_clicked"; payload: { session_id: string } }
  | { type: "new_session_clicked" }
  | { type: "first_message_sent"; payload: { content: string } }
  | { type: "refresh_session_list" }
  | {
      type: "dataset_resolved_by_agent";
      payload: { resource_id: string; resource_type: string };
    }
  | {
      type: "dataset_picked_directly";
      payload: { resource_id: string; resource_type: string };
    }
  | { type: "suggestion_chip_clicked_upload" }
  | { type: "suggestion_chip_clicked_browse_projects" }
  // ── client-reported session-chat OUTCOME members (ADR-050 §e.5 / DR-8/AR-8) —
  //    the report-driven half of ui-state's zero egress. Well-formedness only. ──
  | {
      type: "session_list_loaded";
      payload: {
        sessions: Array<{
          id: string;
          title: string | null;
          last_active_at: string;
          active_dataset_id: string | null;
        }>;
        next_cursor: string | null;
        has_more: boolean;
      };
    }
  | { type: "session_list_failed"; payload: { cause: SessionChatFailureCause } }
  | {
      type: "session_resumed";
      payload: {
        session_id: string;
        transcript: Array<{
          id: string;
          role: "user" | "assistant" | "tool";
          content: string;
          ts: string;
        }>;
        resource?: { type: "dataset" | null; id: string | null };
        session_dataset_unavailable?: boolean;
      };
    }
  | { type: "session_resume_failed"; payload: { cause: SessionChatFailureCause } }
  | { type: "session_created"; payload: { session: { session_id: string } } }
  | { type: "session_create_failed"; payload: { cause: SessionChatFailureCause } }
  | {
      type: "dataset_context_switched";
      payload: { resource: { type: "dataset" | null; id: string | null } };
    }
  | {
      type: "dataset_context_switch_failed";
      payload: { cause: SessionChatFailureCause };
    };

/** Why a client-reported session-chat outcome failed (ADR-050 §e.5). Mirrors
 *  the shared `SessionChatFailureCause` (string-literal unions with equal
 *  members are assignable). */
type SessionChatFailureCause =
  | "list_sessions_degraded"
  | "session_resume_failed"
  | "session_create_failed"
  | "dataset_access_denied"
  | "dataset_context_switch_failed";

const causeTag = z.string().refine(isUnderlyingCauseTag, {
  message: "tag must be a known UnderlyingCauseTag",
});

/** The {id,name} display snapshot a client-reported org/project outcome carries
 *  (ADR-050 §e.1). Well-formedness only — the resource's existence is the
 *  client's earned-trust assertion, never re-probed here (INV-PCO). */
const idNameSnapshot = z.object({ id: z.string(), name: z.string() }).passthrough();

const orgCreateFailureCause = z.enum([
  "org_name_taken",
  "org_name_invalid",
  "org_create_failed",
]);
const scopeMismatchCause = z.enum([
  "cross_tenant",
  "project_not_found",
  "access_revoked",
]);
const resourceType = z.string();
const sessionChatFailureCause = z.enum([
  "list_sessions_degraded",
  "session_resume_failed",
  "session_create_failed",
  "dataset_access_denied",
  "dataset_context_switch_failed",
]);
const sessionSummary = z
  .object({
    id: z.string(),
    title: z.string().nullable(),
    last_active_at: z.string(),
    active_dataset_id: z.string().nullable(),
  })
  .passthrough();
const transcriptMessage = z
  .object({
    id: z.string(),
    role: z.enum(["user", "assistant", "tool"]),
    content: z.string(),
    ts: z.string(),
  })
  .passthrough();
const resourceRef = z
  .object({ type: z.string().nullable(), id: z.string().nullable() })
  .passthrough();

/** The closed wire vocabulary the StateProxy may POST. Pinned to the shared
 *  `ChatAppWireEvent` union (ADR-050 §e.2) — every closed-union member has an arm
 *  here; an unmodeled `type` fails `safeParse` → 400 in every phase. */
const chatAppWireEventSchema = z.discriminatedUnion(
  "type",
  [
    // ── client-reported onboarding outcomes ──
    z.object({ type: z.literal("org_found"), payload: z.object({ org: idNameSnapshot }).passthrough() }),
    z.object({ type: z.literal("org_not_found"), payload: z.object({}).passthrough() }),
    z.object({ type: z.literal("org_created"), payload: z.object({ org: idNameSnapshot }).passthrough() }),
    // ── client-reported project-context outcomes ──
    z.object({ type: z.literal("scope_resolved"), payload: z.object({ project: idNameSnapshot }).passthrough() }),
    z.object({ type: z.literal("no_projects_found"), payload: z.object({}).passthrough() }),
    z.object({ type: z.literal("project_created"), payload: z.object({ project: idNameSnapshot }).passthrough() }),
    // ── legacy kept members (known-but-unhandled → 200; retire in a later slice) ──
    z.object({ type: z.literal("org_form_submitted"), payload: z.object({ org_name: z.string() }).passthrough() }),
    z.object({ type: z.literal("create_project_submitted"), payload: z.object({ org_name: z.string() }).passthrough() }),
    z.object({ type: z.literal("switching_project_intent"), payload: z.object({ new_project_id: z.string() }).passthrough() }),
    // ── failure-simulation side-channel (gate-authorized) ──
    z.object({ type: z.literal("__force_failure__"), payload: z.object({ tag: causeTag }).passthrough() }),
    // ── deep link + restart (route-collapsed events) ──
    z.object({
      type: z.literal("open_deep_link"),
      payload: z
        .object({
          intent_project_id: z.string().optional(),
          intent_session_id: z.string().optional(),
          intent_resource_id: z.string().optional(),
          intent_resource_type: z.string().optional(),
        })
        .passthrough(),
    }),
    z.object({
      type: z.literal("session_begin"),
      payload: z.object({ force_restart: z.boolean().optional() }).passthrough().optional(),
    }),
    // ── client-reported failure / outcome members ──
    z.object({
      type: z.literal("org_create_failed"),
      payload: z.object({ cause: orgCreateFailureCause, org_name: z.string().optional() }).passthrough(),
    }),
    z.object({
      type: z.literal("project_create_failed"),
      payload: z.object({ cause: z.literal("project_create_failed") }).passthrough(),
    }),
    z.object({ type: z.literal("scope_mismatch"), payload: z.object({ cause: scopeMismatchCause }).passthrough() }),
    z.object({ type: z.literal("project_switched"), payload: z.object({ project: idNameSnapshot }).passthrough() }),
    // ── surviving session-chat UI intents ──
    z.object({ type: z.literal("session_clicked"), payload: z.object({ session_id: z.string() }).passthrough() }),
    z.object({ type: z.literal("new_session_clicked") }),
    z.object({ type: z.literal("first_message_sent"), payload: z.object({ content: z.string() }).passthrough() }),
    z.object({ type: z.literal("refresh_session_list") }),
    z.object({
      type: z.literal("dataset_resolved_by_agent"),
      payload: z.object({ resource_id: z.string(), resource_type: resourceType }).passthrough(),
    }),
    z.object({
      type: z.literal("dataset_picked_directly"),
      payload: z.object({ resource_id: z.string(), resource_type: resourceType }).passthrough(),
    }),
    z.object({ type: z.literal("suggestion_chip_clicked_upload") }),
    z.object({ type: z.literal("suggestion_chip_clicked_browse_projects") }),
    // ── client-reported session-chat OUTCOME members (ADR-050 §e.5 / DR-8) ──
    z.object({
      type: z.literal("session_list_loaded"),
      payload: z
        .object({
          sessions: z.array(sessionSummary),
          next_cursor: z.string().nullable(),
          has_more: z.boolean(),
        })
        .passthrough(),
    }),
    z.object({
      type: z.literal("session_list_failed"),
      payload: z.object({ cause: sessionChatFailureCause }).passthrough(),
    }),
    z.object({
      type: z.literal("session_resumed"),
      payload: z
        .object({
          session_id: z.string(),
          transcript: z.array(transcriptMessage),
          resource: resourceRef.optional(),
          session_dataset_unavailable: z.boolean().optional(),
        })
        .passthrough(),
    }),
    z.object({
      type: z.literal("session_resume_failed"),
      payload: z.object({ cause: sessionChatFailureCause }).passthrough(),
    }),
    z.object({
      type: z.literal("session_created"),
      payload: z
        .object({ session: z.object({ session_id: z.string() }).passthrough() })
        .passthrough(),
    }),
    z.object({
      type: z.literal("session_create_failed"),
      payload: z.object({ cause: sessionChatFailureCause }).passthrough(),
    }),
    z.object({
      type: z.literal("dataset_context_switched"),
      payload: z.object({ resource: resourceRef }).passthrough(),
    }),
    z.object({
      type: z.literal("dataset_context_switch_failed"),
      payload: z.object({ cause: sessionChatFailureCause }).passthrough(),
    }),
  ],
);

// Compile-time PIN: the parsed schema output must be assignable to the shared
// closed union (ADR-050 §e.2). This `satisfies`-style assignment fails to compile
// if an arm drifts from `ChatAppWireEvent`, keeping the ACL closed against the SSOT.
const _wireEventSchemaPin: z.ZodType<ChatAppWireEvent> =
  chatAppWireEventSchema as unknown as z.ZodType<ChatAppWireEvent>;
void _wireEventSchemaPin;

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
      bookkeepingFromLog(
        await runtime.eventLog.read(`${child}:${principal_id}`),
      ),
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
      return "onboarding";
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
      actor = await coldStart(
        runtime,
        principal_id,
        bearer,
        request_id,
        user_email,
      );
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

    // Closed wire-event ACL (ADR-050 §e.2): EVERY non-session_begin POST is
    // validated against the closed `ChatAppWireEvent` schema IN EVERY PHASE — an
    // unmodeled `type` → 400 regardless of which child is active (no phase-scoped
    // dispatch). A known-but-out-of-phase event passes the ACL and forwards
    // verbatim; the parent's phase-gated handlers DROP it if its child is not
    // alive (no transition, process stays alive — the crash class is
    // unrepresentable). Legacy kept members converge 200 (known, unhandled).
    const parsed = chatAppWireEventSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_request", issues: parsed.error.issues },
        400,
      );
    }
    const evType = parsed.data.type;
    const evPayload =
      (parsed.data as { payload?: Record<string, unknown> }).payload ?? {};

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

  // POST /state/keepalive — refresh the sliding TTL on the principal's persisted
  // keys (snapshot + the three canonical child event logs) WITHOUT mutating state
  // or cold-starting (Decision 3a: a read-shaped touch). The client's idle tracker
  // fires this debounced (~5-min cadence) so an active-but-idle session never
  // lapses; when the user goes idle the touches stop and the keys expire, resetting
  // the flow to `login` on next contact. Best-effort + always 204 (idempotent — a
  // touch on an already-expired/absent key is a no-op).
  router.post("/state/keepalive", async (c) => {
    const principal_id = c.req.header("X-User-Id") ?? "";
    if (!principal_id) return c.json({ error: "invalid_request" }, 400);
    try {
      await Promise.all([
        runtime.snapshotStore.touch(principal_id),
        ...CANONICAL_CHILDREN.map((child) =>
          runtime.eventLog.touch(`${child}:${principal_id}`),
        ),
      ]);
    } catch {
      // Best-effort: a TTL refresh failure must never surface to the client; the
      // next write (or the next keep-alive) re-establishes the window.
    }
    return c.body(null, 204);
  });

  // POST /state/logout — fully CLEAR a principal's flow on sign-out: stop the live
  // actor and drop its persisted snapshot + all three canonical child event logs.
  // The SPA calls this (while the cookie is still valid) before /api/auth/logout so
  // a later login re-derives from the backend SSOT rather than resuming a stale
  // `engaged` snapshot. Distinct from `session_begin{force_restart}` (which
  // recycles AND cold-starts a fresh onboarding flow); this leaves NO actor.
  router.post("/state/logout", async (c) => {
    const principal_id = c.req.header("X-User-Id") ?? "";
    if (!principal_id) return c.json({ error: "invalid_request" }, 400);
    runtime.registry.recycle(principal_id);
    await Promise.allSettled([
      runtime.snapshotStore.reset(principal_id),
      ...CANONICAL_CHILDREN.map((child) =>
        runtime.eventLog.reset(`${child}:${principal_id}`),
      ),
    ]);
    return c.body(null, 204);
  });

  // GET /state/stream — .subscribe(): SSE of the whole-actor document. First frame
  // is the current document; each retained event on ANY of the three child logs
  // re-derives + emits a fresh document (the union-subscribed seam).
  router.get("/state/stream", async (c) => {
    const principal_id = c.req.header("X-User-Id") ?? "";
    const sinceParam = c.req.query("since") ?? "$";
    const budgetMs = Math.min(
      Math.max(
        parseInt(c.req.query("budget_ms") ?? "25000", 10) || 25_000,
        1_000,
      ),
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
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
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

/** Forward a validated wire event to the ChatApp actor RAW: `{ type, ...payload }`
 *  (CDO-S3 / ADR-049 §4). The parent's phase-gated handlers route it to the live
 *  child verbatim — there is no `child_event` envelope and no
 *  `switching_project_intent → PROJECT_SWITCH` translation (the switch is now an
 *  ordinary project-context vocabulary member, `project_switched`, routed on
 *  `engaged`). A known-but-out-of-phase event has no handler on the current state
 *  and is DROPPED by XState (the settled-child crash class is unrepresentable). */
function forwardToActor(
  actor: AnyActorRef,
  type: string,
  payload: Record<string, unknown>,
): void {
  actor.send({ type, ...payload } as Parameters<AnyActorRef["send"]>[0]);
}

/** Extract the forwarded Bearer (L4) from the Authorization header; "" when
 *  absent (the onboarding re-verify then fails → session_rejected). */
function readBearerToken(c: Context): string {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? "";
}
