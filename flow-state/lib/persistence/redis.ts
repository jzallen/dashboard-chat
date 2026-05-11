// SCAFFOLD: true
//
// RedisFlowEventLog — capability-presence-dispatched adapter satisfying
// the FlowEventLog port. Key prefix: `flow:{flow_id}:events` where
// flow_id = "<machine-name>:<principal_id>" per ADR-030 §SD3 (amends
// ADR-027 §3 to mandate principal_id for multi-tenant safety).
//
// Probe contract: XADD/XRANGE/DEL round-trip on startup. HARD-fail.

import type { FlowEvent } from "../projection.ts";

export const __SCAFFOLD__ = true;

export interface FlowEventLog {
  append(flow_id: string, event: FlowEvent): Promise<void>;
  read(flow_id: string): Promise<FlowEvent[]>;
  probe(): Promise<void>;
}

export function createRedisFlowEventLog(_redisUrl: string): FlowEventLog {
  throw new Error("Not yet implemented — RED scaffold");
}

export function createNoopFlowEventLog(): FlowEventLog {
  throw new Error("Not yet implemented — RED scaffold");
}
