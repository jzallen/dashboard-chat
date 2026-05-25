// RedisFlowEventLog — capability-presence-dispatched adapter satisfying the
// FlowEventLog port. Key prefix: `ui-state:{flow_id}:events` where
// flow_id = "<machine-name>:<principal_id>" per ADR-030 §SD3.
//
// Probe contract: XADD/XRANGE/DEL round-trip on a probe key. HARD-fail at
// startup if any step fails when REDIS_URL is set. When REDIS_URL is unset,
// the noop fallback is used (matches ADR-018 capability-presence dispatch).

import { Redis } from "ioredis";

import { FlowId } from "../flow-id.ts";
import { FlowEvent } from "../projection.ts";

export interface FlowEventLog {
  append(flow_id: string, event: FlowEvent): Promise<void>;
  read(flow_id: string): Promise<FlowEvent[]>;
  /** Drop the entire event stream for this flow. Used when `begin` resets a
   *  prior auth attempt — a fresh sign-in is a fresh flow. */
  reset(flow_id: string): Promise<void>;
  /** Long-poll subscribe to a flow's event stream starting at `sinceId`
   *  (Redis stream id, or "$" for events arriving AFTER subscription).
   *
   *  Per DWD-9: SSE projection-stream substrate. Yields one FlowEvent per
   *  new entry. Bounded by `blockMs` (default 25_000 — see SSE handler in
   *  ui-state/index.ts which closes the response when the iterator returns).
   *
   *  The iterator is exhausted when:
   *    - `blockMs` elapses without a new event (yields nothing, completes),
   *    - The caller invokes `.return()` (AbortController on the HTTP side),
   *    - The Redis connection drops.
   */
  subscribe(flow_id: string, sinceId: string, blockMs?: number): AsyncIterable<FlowEvent>;
  probe(): Promise<void>;
  close(): Promise<void>;
}

function streamKey(flow_id: string): string {
  return `ui-state:${flow_id}:events`;
}

function serialize(event: FlowEvent): string[] {
  return [
    "ts",
    event.ts,
    "type",
    event.type,
    "payload",
    JSON.stringify(event.payload),
    "request_id",
    event.request_id,
  ];
}

function deserialize(fields: string[]): FlowEvent {
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return {
    ts: obj.ts ?? "",
    type: obj.type ?? "",
    payload: obj.payload ? (JSON.parse(obj.payload) as Record<string, unknown>) : {},
    request_id: obj.request_id ?? "",
  };
}

export function createRedisFlowEventLog(redisUrl: string): FlowEventLog {
  const client = new Redis(redisUrl, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });

  return {
    async append(flow_id: string, event: FlowEvent): Promise<void> {
      await client.xadd(streamKey(flow_id), "*", ...serialize(event));
    },

    async read(flow_id: string): Promise<FlowEvent[]> {
      const entries = await client.xrange(streamKey(flow_id), "-", "+");
      return entries.map(([, fields]) => deserialize(fields));
    },

    async reset(flow_id: string): Promise<void> {
      await client.del(streamKey(flow_id));
    },

    async *subscribe(
      flow_id: string,
      sinceId: string,
      blockMs = 25_000,
    ): AsyncIterable<FlowEvent> {
      // Use a dedicated subscriber connection — `xread BLOCK` holds the
      // connection for the duration of the block, so we can't share with
      // the append/read traffic that the rest of the orchestrator uses.
      const sub = client.duplicate();
      try {
        let cursor = sinceId;
        const deadline = Date.now() + blockMs;
        while (Date.now() < deadline) {
          const remainingMs = Math.max(50, deadline - Date.now());
          const res = (await sub.xread(
            "BLOCK",
            Math.min(remainingMs, blockMs),
            "STREAMS",
            streamKey(flow_id),
            cursor,
          )) as Array<[string, Array<[string, string[]]>]> | null;
          if (!res) break; // BLOCK timed out — exit cleanly
          for (const [, entries] of res) {
            for (const [entryId, fields] of entries) {
              cursor = entryId;
              yield deserialize(fields);
            }
          }
        }
      } finally {
        await sub.quit().catch(() => undefined);
      }
    },

    async probe(): Promise<void> {
      const probeKey = `ui-state:__probe__:${Date.now()}`;
      // The probe is a health-check, not a real flow event; its transient
      // flowId is synthetic and ignored by serialize() (the 4-field
      // allow-list). Routed through FlowEvent.from so no `ts: new Date()`
      // literal survives.
      const probeEvent = FlowEvent.from(FlowId.of("__probe__", ""), {
        type: "probe",
        payload: {},
        request_id: "probe",
      });
      await client.xadd(probeKey, "*", ...serialize(probeEvent));
      const read = await client.xrange(probeKey, "-", "+");
      if (read.length !== 1) {
        throw new Error(`probe failed: expected 1 entry, got ${read.length}`);
      }
      await client.del(probeKey);
    },

    async close(): Promise<void> {
      await client.quit();
    },
  };
}

export function createNoopFlowEventLog(): FlowEventLog {
  // In-memory map for single-process testing/dev when REDIS_URL is absent.
  // Per ADR-018, this is the noop fallback — NOT a Redis substitute for
  // multi-replica scenarios.
  const store = new Map<string, FlowEvent[]>();
  // Per-flow subscribers — invoked synchronously after append() lands.
  const subscribers = new Map<string, Set<(event: FlowEvent) => void>>();

  return {
    async append(flow_id: string, event: FlowEvent): Promise<void> {
      const list = store.get(flow_id) ?? [];
      list.push(event);
      store.set(flow_id, list);
      const subs = subscribers.get(flow_id);
      if (subs) {
        for (const cb of subs) {
          try {
            cb(event);
          } catch {
            // Defensive — subscriber callbacks must not break append.
          }
        }
      }
    },

    async read(flow_id: string): Promise<FlowEvent[]> {
      return store.get(flow_id) ?? [];
    },

    async reset(flow_id: string): Promise<void> {
      store.delete(flow_id);
    },

    async *subscribe(
      flow_id: string,
      _sinceId: string,
      blockMs = 25_000,
    ): AsyncIterable<FlowEvent> {
      // Capture events arriving AFTER subscription. The noop adapter is
      // single-process; subscribers register a callback and resolve a
      // promise on each event. Bounded by `blockMs` like the Redis path.
      let resolveNext: ((value: FlowEvent | null) => void) | null = null;
      const queue: FlowEvent[] = [];
      const cb = (event: FlowEvent) => {
        if (resolveNext) {
          const r = resolveNext;
          resolveNext = null;
          r(event);
        } else {
          queue.push(event);
        }
      };
      const subs = subscribers.get(flow_id) ?? new Set();
      subs.add(cb);
      subscribers.set(flow_id, subs);
      try {
        const deadline = Date.now() + blockMs;
        while (Date.now() < deadline) {
          if (queue.length > 0) {
            yield queue.shift() as FlowEvent;
            continue;
          }
          const remainingMs = Math.max(0, deadline - Date.now());
          const event = await Promise.race([
            new Promise<FlowEvent | null>((resolve) => {
              resolveNext = resolve;
            }),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), remainingMs)),
          ]);
          if (event === null) break;
          yield event;
        }
      } finally {
        subs.delete(cb);
        if (subs.size === 0) subscribers.delete(flow_id);
      }
    },

    async probe(): Promise<void> {
      // Noop has no external dependency to probe.
    },

    async close(): Promise<void> {
      store.clear();
      subscribers.clear();
    },
  };
}

/**
 * Capability-presence dispatch (ADR-018 inheritance): REDIS_URL present →
 * Redis tier; absent → noop fallback.
 */
export function selectFlowEventLog(redisUrl: string | undefined): FlowEventLog {
  if (redisUrl && redisUrl.length > 0) {
    return createRedisFlowEventLog(redisUrl);
  }
  return createNoopFlowEventLog();
}
