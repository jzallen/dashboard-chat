// Probe for ADR-039 C7 (intent-prefix-deeplink-only).
//
// This file is NOT executed. It is a static fixture that ESLint lints in
// the normal pass. The plugin's test suite asserts the rule fires on the
// `intent_session_id` declaration below — the canonical post-MR-D
// violation example from the audit (a click-captured resume intent
// masquerading as a URL-level deep-link intent). The `intent_project_id`
// declaration is the negative case — same prefix, but on the allowlist
// (true URL-level deep-link intent per ADR-039 §C7 example).
//
// Pattern matches ADR-030's amendment §"Earned Trust principle 12".

// EXPECTED_VIOLATION — the rule MUST flag this type's `intent_session_id`
// field. The audit identified this name as carrying click-captured resume
// intent (audit Tier-1 #2); the resume intent should use the
// `pending_resume_` prefix per ADR-039 §C7 post-MR-D. Until MR-D lands,
// the violation is grandfathered in projection.ts at warn severity; the
// probe demonstrates that the rule would catch it if introduced anew.
interface FakeContextProbeViolation {
  intent_session_id: string | null;
}

// EXPECTED_VIOLATION — value-level declaration carries the same field.
// The rule's selector includes Property nodes so the type-level and
// value-level declarations stay aligned.
const fakeContextValueProbe = {
  intent_session_id: null as string | null,
};

// PASSING — true URL-level deep-link intent per ADR-039 §C7 example.
// On the allowlist; the rule MUST NOT fire.
interface FakeContextProbePassing {
  intent_project_id: string | null;
}

// PASSING — name does not start with `intent_`, so the rule does not
// apply.
interface FakeContextProbeUnrelated {
  pending_project_name: string;
}

export { fakeContextValueProbe };
export type {
  FakeContextProbePassing,
  FakeContextProbeUnrelated,
  FakeContextProbeViolation,
};
