// RedisFlowEventLog — capability-presence-dispatched adapter satisfying the
// FlowEventLog port. Key prefix: `flow:{flow_id}:events` where
// flow_id = "<machine-name>:<principal_id>" per ADR-030 §SD3.
//
// Probe contract: XADD/XRANGE/DEL round-trip on a probe key. HARD-fail at
// startup if any step fails when REDIS_URL is set. When REDIS_URL is unset,
// the noop fallback is used (matches ADR-018 capability-presence dispatch).

import { Redis } from "ioredis";

import type { FlowEvent } from "../projection.ts";

export interface FlowEventLog {
  append(flow_id: string, event: FlowEvent): Promise<void>;
  read(flow_id: string): Promise<FlowEvent[]>;
  probe(): Promise<void>;
  close(): Promise<void>;
}

function streamKey(flow_id: string): string {
  return `flow:${flow_id}:events`;
}

function serialize(event: FlowEvent): string[] {
  return [
    "ts",
    event.ts,
    "type",
    event.type,
    "payload",
    JSON.stringify(event.payload),
    "correlation_id",
    event.correlation_id,
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
    correlation_id: obj.correlation_id ?? "",
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

    async probe(): Promise<void> {
      const probeKey = `flow:__probe__:${Date.now()}`;
      const probeEvent: FlowEvent = {
        ts: new Date().toISOString(),
        type: "probe",
        payload: {},
        correlation_id: "probe",
      };
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

  return {
    async append(flow_id: string, event: FlowEvent): Promise<void> {
      const list = store.get(flow_id) ?? [];
      list.push(event);
      store.set(flow_id, list);
    },

    async read(flow_id: string): Promise<FlowEvent[]> {
      return store.get(flow_id) ?? [];
    },

    async probe(): Promise<void> {
      // Noop has no external dependency to probe.
    },

    async close(): Promise<void> {
      store.clear();
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
