// SCAFFOLD: true
//
// FlowOrchestrator — root XState v5 actor.
//
// Spawns + supervises per-flow machines. Owns FREEZE/THAW broadcast across
// the actor tree per ADR-027 §"Cross-machine freeze". The replay buffer
// (5s timeout, 16 max queued mutations) lives here, not on the FE.

export const __SCAFFOLD__ = true;

export interface FlowOrchestratorDeps {
  eventLog: unknown;
  scopeResolver: unknown;
}

export function createFlowOrchestrator(_deps: FlowOrchestratorDeps): never {
  throw new Error("Not yet implemented — RED scaffold");
}

export function broadcastFreeze(_orchestrator: unknown): never {
  throw new Error("Not yet implemented — RED scaffold");
}

export function broadcastThaw(_orchestrator: unknown): never {
  throw new Error("Not yet implemented — RED scaffold");
}
