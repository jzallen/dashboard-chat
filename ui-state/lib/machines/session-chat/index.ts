// Barrel for the session-chat XState machine directory.
//
// Re-exports the public surface so callers (orchestrator.ts, ui-state/index.ts,
// the acceptance harness) resolve `./machines/session-chat` and pick up the
// named exports through this barrel. The machine is mapping-only; its pieces
// live under ./setup/ (actors.ts, guards.ts, actions.ts, types.ts) — the barrel
// hides that split so the public surface is the same as before the extraction.
//
// Public surface (alphabetical-by-export):
//   - createSessionChatMachine + SessionChatMachineDeps
//   - loadSessionListActor, loadSessionListFn
//   - resumeSessionActor, resumeSessionFn
//   - createSessionEagerlyActor, createSessionEagerlyFn
//   - switchDatasetContextActor, switchDatasetContextFn
//   - all context / event / state / actor I-O types
//   - re-exported ActiveScope (for caller convenience)

export { createSessionChatMachine } from "./machine.ts";

export {
  createSessionEagerlyActor,
  createSessionEagerlyFn,
  loadSessionListActor,
  loadSessionListFn,
  resumeSessionActor,
  resumeSessionFn,
  switchDatasetContextActor,
  switchDatasetContextFn,
  type ActiveScope,
  type CreateSessionEagerlyActor,
  type CreateSessionEagerlyInput,
  type CreateSessionEagerlyOutput,
  type LoadSessionListActor,
  type LoadSessionListInput,
  type LoadSessionListOutput,
  type ResumeSessionActor,
  type ResumeSessionInput,
  type ResumeSessionOutput,
  type SessionChatMachineDeps,
  type SwitchDatasetContextActor,
  type SwitchDatasetContextInput,
  type SwitchDatasetContextOutput,
} from "./setup/actors.ts";

export type {
  SessionChatCauseTag,
  SessionChatEvent,
  SessionChatMachineContext,
  SessionChatState,
  SessionSummary,
  TranscriptMessage,
} from "./setup/types.ts";
