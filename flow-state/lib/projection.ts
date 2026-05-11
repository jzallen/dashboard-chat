// SCAFFOLD: true
//
// ProjectionBuilder — folds FlowEvent[] into the public projection shape.
//
// The wire format declared by `design/handoff-design-to-distill.md` §4.
// The TS harness reads this shape; the FE renders from this shape; the
// acceptance tests assert against this shape.

import type { ActiveScope } from "./active-scope.ts";

export const __SCAFFOLD__ = true;

export interface FlowEvent {
  ts: string;
  type: string;
  payload: Record<string, unknown>;
  correlation_id: string;
}

export interface FlowProjection {
  flow_id: string;
  state: string;
  context: Record<string, unknown>;
  active_scope: ActiveScope;
  sequence_id: number;
  last_event_at: string;
  correlation_id: string;
}

export function buildProjection(
  _events: FlowEvent[],
  _snapshot?: FlowProjection,
): FlowProjection {
  throw new Error("Not yet implemented — RED scaffold");
}
