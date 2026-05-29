// Barrel for the session-chat XState machine directory.
//
// Re-exports the public surface so callers (orchestrator.ts, ui-state/index.ts,
// the acceptance harness) resolve `./machines/session-chat` and pick up the
// named exports through this barrel.
//
// Public surface (alphabetical-by-export):
//   - createSessionChatMachine + SessionChatMachineDeps
//   - loadSessionListActor, loadSessionListFn
//   - resumeSessionActor, resumeSessionFn
//   - createSessionEagerlyActor, createSessionEagerlyFn
//   - all context / event / state / actor I-O types
//   - re-exported ActiveScope (for caller convenience)

export {
  createSessionChatMachine,
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
  type SessionChatCauseTag,
  type SessionChatEvent,
  type SessionChatMachineContext,
  type SessionChatMachineDeps,
  type SessionChatState,
  type SessionSummary,
  type SwitchDatasetContextActor,
  type SwitchDatasetContextInput,
  type SwitchDatasetContextOutput,
  type TranscriptMessage,
} from "./machine.ts";
