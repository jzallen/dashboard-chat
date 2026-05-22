// Barrel for the session-onboarding XState machine directory.
//
// Re-exports the public surface of the SessionOnboardingMachine. Callers
// (orchestrator.ts, ui-state/index.ts, the in-package tests) resolve
// `./machines/session-onboarding` through this barrel.
//
// Public surface (alphabetical-by-export):
//   - createSessionOnboardingMachine (takes NO params — every external actor is
//     a config-driven default; there is no deps-injection mechanism)
//   - createOrgFn, reissueOrgJwtFn (split halves of the create+reissue path,
//     used by the getOrgAndReissue resolver)
//   - getOrgAndReissue (the config-agnostic org-create + reissue resolver that
//     folds the forced-failure harness in via input.force_reissue_failures; the
//     machine wraps it as the default createOrgAndReissue actor)
//   - getWorkOSUserInfo (the config-agnostic WorkOS-userinfo re-verify resolver;
//     the machine wraps it as the default workosUserInfo actor)
//   - RequestClient (= typeof fetch — the injected I/O port alias) +
//     SessionOnboardingDeps (the { request_client } bundle threaded into input)
//   - all context / event / state / actor I-O types
//   - re-exported UnderlyingCauseTag (re-exported from `../validation.ts`)

export {
  type CreateOrgAndReissueActor,
  type CreateOrgAndReissueInput,
  type CreateOrgAndReissueOutput,
  createOrgFn,
  createSessionOnboardingMachine,
  getOrgAndReissue,
  getSilentReauth,
  getWorkOSUserInfo,
  type OrgValidationInlineError,
  reissueOrgJwtFn,
  type RequestClient,
  type SessionOnboardingContext,
  type SessionOnboardingDeps,
  type SessionOnboardingEvent,
  type SessionOnboardingState,
  type SilentReauthActor,
  type SilentReauthInput,
  type SilentReauthOutcome,
  type UnderlyingCauseTag,
  type WorkOSProfile,
  type WorkOSUserInfoActor,
  type WorkOSUserInfoInput,
} from "./machine.ts";
