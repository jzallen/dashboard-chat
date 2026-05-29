// Barrel for the project-context XState machine directory.
//
// Re-exports the public surface so callers (orchestrator.ts, ui-state/index.ts,
// the acceptance harness) resolve `./machines/project-context` and pick up the
// named exports through this barrel.
//
// Public surface (alphabetical-by-export):
//   - createProjectContextMachine + ProjectContextMachineDeps
//   - createProjectActor, createProjectFn
//   - resolveInitialScopeActor, resolveInitialScopeFn
//   - switchProjectActor, switchProjectFn
//   - validateProjectName + ProjectValidationError (from ./validation.ts)
//   - all context / event / state / actor I-O types
//   - re-exported ActiveScope (for caller convenience)

export {
  createProjectActor,
  createProjectFn,
  createProjectContextMachine,
  resolveInitialScopeActor,
  resolveInitialScopeFn,
  switchProjectActor,
  switchProjectFn,
  type ActiveScope,
  type CreateProjectActor,
  type CreateProjectInput,
  type ProjectContextCauseTag,
  type ProjectContextEvent,
  type ProjectContextMachineContext,
  type ProjectContextMachineDeps,
  type ProjectContextState,
  type ProjectSummary,
  type ResolveInitialScopeActor,
  type ResolveInitialScopeInput,
  type ResolveInitialScopeOutput,
  type SwitchProjectActor,
  type SwitchProjectInput,
  type SwitchProjectOutput,
} from "./machine.ts";

export {
  validateProjectName,
  type ProjectValidationError,
} from "./validation.ts";
