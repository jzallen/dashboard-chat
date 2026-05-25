// Barrel for the ChatApp coordinator machine directory.
//
// Public surface (Phase 1) is intentionally minimal:
//   - createChatAppMachine — the parent-coordinator statechart factory. Children
//     are dependency-injected via `.provide({ actors })` (Phase 1 = fakes,
//     Phase 2 = the real session-onboarding / project-context / session-chat
//     machines).
//   - ChatAppChildLogic — the actor-logic slot type a caller casts a provided
//     child to (XState's `provide` is type-invariant in a child's context).
//   - The wire/hand-off contract types a caller needs to drive or wire ChatApp.
//
// The internal context/guards/actions live under ./machine.ts + ./setup/ and are
// deliberately NOT re-exported.

export { createChatAppMachine } from "./machine.ts";
export type { ChatAppChildLogic } from "./setup/actors.ts";
export type {
  AuthHandoff,
  ChatAppChildEvent,
  ChatAppChildId,
  ChatAppConnectivity,
  ChatAppContext,
  ChatAppEvent,
  ChatAppInput,
  ChatAppLifecycle,
  ChatUserIntent,
  ProjectHandoff,
} from "./setup/types.ts";
