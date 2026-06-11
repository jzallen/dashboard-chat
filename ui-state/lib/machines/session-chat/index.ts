// Barrel for the session-chat XState machine directory.
//
// Re-exports the public surface so callers (orchestrator.ts, ui-state/index.ts,
// the acceptance harness) resolve `./machines/session-chat` and pick up the
// named exports through this barrel. The machine is mapping-only; its pieces
// live under ./setup/ (actors.ts, guards.ts, actions.ts, types.ts) — the barrel
// hides that split so the public surface is the same as before the extraction.
//
// Public surface (REPORT-DRIVEN; the egress actors were deleted at CDO-S5):
//   - createSessionChatMachine + SessionChatMachineDeps (empty deps surface)
//   - re-exported ActiveScope (for caller convenience)
//   - all context / event / state types

export { createSessionChatMachine } from "./machine.ts";

export {
  type ActiveScope,
  type SessionChatMachineDeps,
} from "./setup/actors.ts";

export type {
  SessionChatCauseTag,
  SessionChatEvent,
  SessionChatFailureCause,
  SessionChatMachineContext,
  SessionChatState,
  SessionSummary,
  TranscriptMessage,
} from "./setup/types.ts";
