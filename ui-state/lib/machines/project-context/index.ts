// Barrel for the project-context XState machine directory.
//
// Re-exports the public surface so callers (orchestrator.ts, ui-state/index.ts,
// the acceptance harness) resolve `./machines/project-context` and pick up the
// named exports through this barrel. The surface is stable; the source modules
// behind it (machine.ts + ./setup/*) are an implementation detail.
//
// Public surface (alphabetical-by-export):
//   - createProjectContextMachine (machine.ts) + ProjectContextMachineDeps
//   - createProjectActor, createProjectFn
//   - resolveInitialScopeActor, resolveInitialScopeFn
//   - switchProjectActor, switchProjectFn
//   - validateProjectName + ProjectValidationError (from ./setup/domain.ts)
//   - all context / event / state / actor I-O types
//   - re-exported ActiveScope (for caller convenience)

export { createProjectContextMachine } from "./machine.ts";

export {
  createProjectActor,
  createProjectFn,
  resolveInitialScopeActor,
  resolveInitialScopeFn,
  switchProjectActor,
  switchProjectFn,
  type ActiveScope,
  type CreateProjectActor,
  type CreateProjectInput,
  type ProjectContextMachineDeps,
  type ResolveInitialScopeActor,
  type ResolveInitialScopeInput,
  type ResolveInitialScopeOutput,
  type SwitchProjectActor,
  type SwitchProjectInput,
  type SwitchProjectOutput,
} from "./setup/actors.ts";

export type {
  ProjectContextCauseTag,
  ProjectContextEvent,
  ProjectContextMachineContext,
  ProjectContextState,
  ProjectSummary,
} from "./setup/types.ts";

export {
  validateProjectName,
  type ProjectValidationError,
} from "./setup/domain.ts";
