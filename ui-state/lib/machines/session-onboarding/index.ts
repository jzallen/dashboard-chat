// Barrel for the session-onboarding XState machine directory.
//
// Re-exports the public surface of the SessionOnboardingMachine. Callers
// (orchestrator.ts, ui-state/index.ts, the in-package tests) resolve
// `./machines/session-onboarding` through this barrel.
//
// The surface is split across two modules:
//   - machine.ts  — the statechart (createSessionOnboardingMachine), the
//     no-I/O silent-reauth resolver (getSilentReauth), the context/event/state
//     types, and the XState-bound actor-type aliases.
//   - upstream.ts — the external-service request layer: the resolvers that talk
//     to WorkOS + the backend (getWorkOSUserInfo, getUserOrg, loadVerifiedSession,
//     createOrgFn, reissueOrgJwtFn, getOrgAndReissue) and the I/O contracts they
//     exchange with the machine (RequestClient, SessionOnboardingDeps,
//     WorkOSProfile, VerifiedSession, LoadSessionInput, CreateOrgAndReissue*).

export {
  type CreateOrgAndReissueActor,
  createSessionOnboardingMachine,
  getSilentReauth,
  type LoadSessionActor,
  type OrgValidationInlineError,
  type SessionOnboardingContext,
  type SessionOnboardingEvent,
  type SessionOnboardingState,
  type SilentReauthActor,
  type SilentReauthInput,
  type SilentReauthOutcome,
  type UnderlyingCauseTag,
} from "./machine.ts";
export {
  type CreateOrgAndReissueInput,
  type CreateOrgAndReissueOutput,
  createOrgFn,
  getOrgAndReissue,
  getUserOrg,
  getWorkOSUserInfo,
  type LoadSessionInput,
  loadVerifiedSession,
  type RequestClient,
  type SessionOnboardingDeps,
  type VerifiedSession,
  type WorkOSProfile,
} from "./upstream.ts";
