// Barrel for the project-context XState machine directory.
//
// Re-exports the public surface that previously lived in the flat
// `ui-state/lib/machines/project-context.ts` file, post-DWD-13 SRP split.
// Callers (orchestrator.ts, ui-state/index.ts, the acceptance harness)
// continue resolving `./machines/project-context` and pick up the same
// named exports through this barrel — no caller import path change is
// required at the bare-module-specifier level.
//
// Public surface (alphabetical-by-export):
//   - createProjectContextMachine + ProjectContextMachineDeps
//   - createProjectActor, createProjectFn
//   - resolveInitialScopeActor, resolveInitialScopeFn
//   - switchProjectActor, switchProjectFn
//   - validateProjectName + ProjectValidationError (from ./validation.ts)
//   - all context / event / state / actor I-O types
//   - re-exported ActiveScope (originally re-exported by the flat file
//     for caller convenience)

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
