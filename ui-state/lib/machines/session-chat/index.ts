// Barrel for the session-chat XState machine directory.
//
// Re-exports the public surface that previously lived in the flat
// `ui-state/lib/machines/session-chat.ts` file, post-DWD-13 SRP split.
// Callers (orchestrator.ts, ui-state/index.ts, the acceptance harness)
// continue resolving `./machines/session-chat` and pick up the same
// named exports through this barrel — no caller import path change is
// required at the bare-module-specifier level.
//
// Public surface (alphabetical-by-export):
//   - createSessionChatMachine + SessionChatMachineDeps
//   - loadSessionListActor, loadSessionListFn
//   - resumeSessionActor, resumeSessionFn
//   - createSessionEagerlyActor, createSessionEagerlyFn
//   - all context / event / state / actor I-O types
//   - re-exported ActiveScope (originally re-exported by the flat file
//     for caller convenience)

export {
  createSessionChatMachine,
  createSessionEagerlyActor,
  createSessionEagerlyFn,
  loadSessionListActor,
  loadSessionListFn,
  resumeSessionActor,
  resumeSessionFn,
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
  type TranscriptMessage,
} from "./machine.ts";
