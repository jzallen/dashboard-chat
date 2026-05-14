import type { KnobCanonicalName } from "./manifest.schema";

/**
 * Typed accessor for canonical knob names. Each property's value is branded
 * as `KnobCanonicalName` so calls like `shouldInject(KNOB.forceCreateSessionFailure, ctx)`
 * type-check; a raw string literal cannot reach `shouldInject` without an
 * explicit cast or `assertKnown` narrowing.
 */
export const KNOB: {
  readonly forceCreateProjectFailure: KnobCanonicalName;
  readonly forceListSessionsFailure: KnobCanonicalName;
  readonly forceCreateSessionFailure: KnobCanonicalName;
  readonly forceReissueFailures: KnobCanonicalName;
  readonly forceFailureTag: KnobCanonicalName;
  readonly expireToken: KnobCanonicalName;
};
