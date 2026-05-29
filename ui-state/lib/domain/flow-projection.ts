// FlowProjection — the public read-model envelope produced by `buildProjection`
// (lib/projection.ts) and read by the FE, the agent (X-Active-Scope), and the
// acceptance harness. The envelope shape is the SSOT contract every consumer
// reads; flow-specific state lives opaquely inside `context`.

import type { ActiveScope } from "./active-scope.ts";

export interface FlowProjection {
  flow_id: string;
  state: string;
  context: Record<string, unknown>;
  active_scope: ActiveScope;
  sequence_id: number;
  last_event_at: string;
  request_id: string;
}
