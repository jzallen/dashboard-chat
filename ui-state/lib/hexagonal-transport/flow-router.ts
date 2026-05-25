// Shared HTTP-transport substrate for per-machine flow routers (ADR-040
// §D4/§D5 / LEAF-2). The 670-line `makeFlowRouter` factory that lived in
// `ui-state/index.ts` is decomposed into:
//
//   - this substrate — the machine-agnostic routes (`/freeze`, `/thaw`,
//     `/projection`, `/projection/stream`) + the shared HTTP helpers
//     (`resultToJson`, `cryptoRandomId`, `freezeThawHandler`);
//   - per-machine `router.ts` files at `ui-state/lib/machines/<machine>/
//     router.ts` — each builds a Hono router with its `/begin`, `/event`,
//     `/open-deep-link` handlers + calls `mountUniformFlowRoutes()` to
//     attach the substrate routes.
//
// ADR-028 invariant preserved: machine packages depend only on this
// substrate + `flow-result.ts` + their own machine module — no machine
// imports another machine. The orchestrator stays the sole cross-machine
// mediator (broadcastFreeze/Thaw is dispatched through the orchestrator,
// which holds the strategy registry; the routes here are uniform glue).
//
// `originFlowId` in `freezeThawHandler` is hardcoded to the login flow id
// for the principal because that is the J-001 broadcast origin per
// US-005 / US-210 (the broadcast loop SKIPS the origin and reaches every
// other spawned actor — so the login flow id is the skip-key, NOT a
// dispatch hint). Identical to the pre-carve factory closure.

import { KNOB, shouldInject } from "@dashboard-chat/shared-failure-simulation";
import type { Context, Env, Hono } from "hono";

import { errorMessage,type Result } from "../flow-result.ts";
import type { FlowOrchestrator } from "../orchestrator.ts";

export { errorMessage };

/** Total mapper for the orchestrator's Result API: success serializes the
 *  projection; `unknown_machine` is the registry-miss 404; every other
 *  failure keeps the prior `{ error, message }` 500 shape byte-identical. */
export function resultToJson(
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
  return c.json({ error: fallbackError, message: result.error.message }, 500);
}

/** Hono's runtime exposes globalThis.crypto; randomUUID is in Node 19+. */
export function cryptoRandomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `corr-${Date.now()}`;
}

/**
 * Cross-machine FREEZE / THAW test-driving endpoint factory (US-005 /
 * US-210). Returns a Hono handler that broadcasts the freeze/thaw
 * lifecycle via the orchestrator. Gated by the same `KNOB.expireToken`
 * failure-simulation gate — these endpoints belong to the same token-
 * expiry test family (ADR-035 closed-by-default in production).
 *
 * `originFlowId` is hardcoded to the J-001 login flow id for the principal:
 * the broadcast loop SKIPS the origin and reaches every other spawned
 * actor, so the J-001 actor need not even exist; the id is only the
 * skip-key (ADR-028:46-48 — J-002 emits nothing here; it is a pure
 * downstream consumer).
 */
export function freezeThawHandler(
  orchestrator: FlowOrchestrator,
  kind: "freeze" | "thaw",
) {
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
    const originFlowId = `session-onboarding:${principal_id}`;
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

/**
 * Attach the strategy-agnostic flow-router routes to `router`. These four
 * endpoints have ZERO per-machine branches today and are pure
 * `orchestrator.*` calls — every per-machine router mounts them
 * identically.
 *
 * `machineName` is the canonical flow-id head segment for the machine this
 * substrate is mounted under (ADR-040). The read routes DERIVE the target
 * flow_id as `${machineName}:${verified-principal}` from the auth-proxy
 * `X-User-Id` header instead of accepting a client-supplied `?flow_id=`
 * query param. Flow identity is `machine:principal` — both halves of which
 * the server already knows (the route's machine + the verified principal) —
 * so a client `flow_id` carried ZERO information and was a leaky abstraction
 * (ADR-040). `freezeThawHandler` likewise derives the broadcast origin from
 * `X-User-Id`. An absent principal derives the `${machineName}:` head whose
 * empty event log folds to the anonymous projection — preserving the prior
 * cold-read semantics without a client-supplied flow_id.
 *
 *   POST /freeze              — cross-machine FREEZE broadcast (US-005)
 *   POST /thaw                — cross-machine THAW broadcast (US-005)
 *   GET  /projection          — single FlowProjection read
 *   GET  /projection/stream   — SSE projection-stream (DWD-9 / RD2)
 */
export function mountUniformFlowRoutes<E extends Env>(
  router: Hono<E>,
  orchestrator: FlowOrchestrator,
  machineName: string,
): void {
  router.post("/freeze", freezeThawHandler(orchestrator, "freeze"));
  router.post("/thaw", freezeThawHandler(orchestrator, "thaw"));

  router.get("/projection", async (c) => {
    const flow_id = `${machineName}:${c.req.header("X-User-Id") ?? ""}`;
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
    const flow_id = `${machineName}:${c.req.header("X-User-Id") ?? ""}`;
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
            encoder.encode(
              `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
            ),
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
}
