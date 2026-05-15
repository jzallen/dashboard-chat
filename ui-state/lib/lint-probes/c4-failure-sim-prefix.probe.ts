// Probe for ADR-039 C4 (no-failure-sim-event-prefix-outside-allowlist).
//
// This file is NOT executed. It is a static fixture that ESLint lints in
// the normal pass, and the plugin's test suite asserts the rule fires on
// the EXPECTED_VIOLATION literal below. The PASSING literal is the
// negative case — same shape, but on the allowlist, so the rule must NOT
// fire.
//
// Pattern matches ADR-030's amendment §"Earned Trust principle 12": every
// lint rule ships with a probe that proves its coverage empirically. The
// probe is the test fixture; this file is data, not code.

// EXPECTED_VIOLATION — the rule MUST flag this literal. The name shape is
// `__token__` and the token is not in the failure-simulation allowlist.
const EXPECTED_VIOLATION = "__user_signed_in__";

// PASSING — the rule MUST NOT flag this literal. Same shape, but on the
// allowlist (ratified failure-simulation knob per ADR-038).
const PASSING_EXPIRE_TOKEN = "__expire_token__";
const PASSING_FORCE_FAILURE = "__force_failure__";

// PASSING — does not match the `__token__` shape (no failure-simulation
// vocabulary).
const PASSING_DOMAIN_EVENT = "sign_in_clicked";

export {
  EXPECTED_VIOLATION,
  PASSING_DOMAIN_EVENT,
  PASSING_EXPIRE_TOKEN,
  PASSING_FORCE_FAILURE,
};
