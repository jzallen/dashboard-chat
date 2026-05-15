// Typed accessor for canonical knob names. Each property is the canonical
// kebab-case string the manifest entry uses for `name`. The TypeScript
// declaration in `knob.d.ts` brands every value as `KnobCanonicalName` so
// callers cannot pass a raw string to `shouldInject` without going through
// the accessor (or `assertKnown`).

export const KNOB = Object.freeze({
  forceCreateProjectFailure: "force-create-project-failure",
  forceListSessionsFailure: "force-list-sessions-failure",
  forceCreateSessionFailure: "force-create-session-failure",
  forceReissueFailures: "force-reissue-failures",
  forceFailureOnAuthRetry: "force-failure-on-auth-retry",
  expireToken: "expire-token",
});
