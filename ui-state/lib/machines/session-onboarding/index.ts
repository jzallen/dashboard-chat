// Barrel for the session-onboarding XState machine directory.
//
// Re-exports the public surface of the SessionOnboardingMachine. Callers
// (orchestrator.ts, ui-state/index.ts, the in-package tests) resolve
// `./machines/session-onboarding` through this barrel.
//
// Public surface (alphabetical-by-export):
//   - createSessionOnboardingMachine + SessionOnboardingDeps
//   - createOrgAndReissueActor, createOrgAndReissueFn
//   - createForcedFailureOrgAndReissueActor (harness-knob construction site;
//     gated by the failure-simulation gate at the HTTP layer)
//   - createOrgFn, reissueOrgJwtFn (split halves of the create+reissue path)
//   - createWorkOSUserInfoActor (production WorkOS-userinfo re-verify wiring)
//   - all context / event / state / actor I-O types
//   - re-exported UnderlyingCauseTag (re-exported from `../validation.ts`)

export {
  createForcedFailureOrgAndReissueActor,
  type CreateOrgAndReissueActor,
  createOrgAndReissueActor,
  createOrgAndReissueFn,
  type CreateOrgAndReissueInput,
  type CreateOrgAndReissueOutput,
  createOrgFn,
  createSessionOnboardingMachine,
  createWorkOSUserInfoActor,
  type OrgValidationInlineError,
  reissueOrgJwtFn,
  type SessionOnboardingContext,
  type SessionOnboardingDeps,
  type SessionOnboardingEvent,
  type SessionOnboardingState,
  type SilentReauthActor,
  type UnderlyingCauseTag,
  type WorkOSProfile,
  type WorkOSUserInfoActor,
  type WorkOSUserInfoInput,
} from "./machine.ts";
