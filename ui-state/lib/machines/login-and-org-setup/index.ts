// Barrel for the login-and-org-setup XState machine directory.
//
// Re-exports the public surface that previously lived in the flat
// `ui-state/lib/machines/login-and-org-setup.ts` file. Callers
// (orchestrator.ts, ui-state/index.ts, ui-state/index.test.ts, the
// orchestrator unit-test suite) now resolve `./machines/login-and-org-setup`
// through this barrel — every named export below preserves the previous
// flat-file surface, so caller diffs are import-path-only.
//
// Public surface (alphabetical-by-export):
//   - createLoginAndOrgSetupMachine + LoginMachineDeps
//   - createOrgAndReissueActor, createOrgAndReissueFn
//   - createForcedFailureOrgAndReissueActor (harness-knob construction site;
//     gated by NWAVE_HARNESS_KNOBS at the HTTP layer)
//   - createOrgFn, reissueOrgJwtFn (split halves of the create+reissue path)
//   - createWorkOSUserInfoActor (production WorkOS-userinfo wiring)
//   - all context / event / state / actor I-O types
//   - re-exported UnderlyingCauseTag (originally re-exported by the flat file
//     for caller convenience; still re-exported from `../validation.ts`)

export {
  createForcedFailureOrgAndReissueActor,
  createLoginAndOrgSetupMachine,
  createOrgAndReissueActor,
  createOrgAndReissueFn,
  createOrgFn,
  createWorkOSUserInfoActor,
  reissueOrgJwtFn,
  type CreateOrgAndReissueActor,
  type CreateOrgAndReissueInput,
  type CreateOrgAndReissueOutput,
  type LoginEvent,
  type LoginMachineContext,
  type LoginMachineDeps,
  type LoginState,
  type OrgValidationInlineError,
  type SilentReauthActor,
  type UnderlyingCauseTag,
  type WorkOSProfile,
  type WorkOSUserInfoActor,
  type WorkOSUserInfoInput,
} from "./machine.ts";
