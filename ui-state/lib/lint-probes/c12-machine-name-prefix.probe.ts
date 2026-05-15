// Probe for ADR-039 C12 (no-machine-name-prefix-on-projection-fields).
//
// This file is NOT executed. It is a static fixture that ESLint lints in
// the normal pass. The plugin's test suite asserts the rule fires on the
// `session_chat_pending_message` declaration below — a synthetic
// machine-name leak that the audit's MR-H rename would never let land.
// The `pending_message` declaration is the negative case — same purpose,
// but named for the data, not the producer.
//
// Pattern matches ADR-030's amendment §"Earned Trust principle 12".

// EXPECTED_VIOLATION — the rule MUST flag this type's
// `session_chat_pending_message` field. The `session_chat_` prefix encodes
// the producer machine's identity into the projection's read shape,
// violating ADR-039 §C12.
interface FakeProjectionProbeViolation {
  session_chat_pending_message: string;
}

// EXPECTED_VIOLATION — value-level declaration carries the same field.
const fakeProjectionValueProbe = {
  session_chat_pending_message: "",
};

// EXPECTED_VIOLATION — same shape, different banned prefix
// (`project_context_`). Demonstrates the rule covers the full prefix set.
interface FakeProjectionProbeViolationProjectContext {
  project_context_org_id: string | null;
}

// PASSING — the field describes data, not producer. The rule MUST NOT
// fire.
interface FakeProjectionProbePassing {
  pending_message: string;
  project_id: string | null;
}

// PASSING — names that merely CONTAIN a machine name as a substring (not
// as the leading prefix) are not violations. `chat_session_id` is data-
// shaped; the rule MUST NOT fire on it.
interface FakeProjectionProbeUnrelated {
  chat_session_id: string | null;
}

// PASSING — reducer dispatch-table entries. The key is a wire-event name
// (the audit's recommended `project_context_*` / `session_chat_*` event
// vocabulary per MR-F / MR-H); the value is the handler function. These
// are dispatch tags, not data fields. The rule MUST NOT fire on either
// of the two arrow-function entries below.
const fakeProjectionReducerTable = {
  project_context_resolution_started: (_state: unknown, _event: unknown) => ({
    state: "resolving_initial_scope",
  }),
  session_chat_recoverable_error: function (_state: unknown, _event: unknown) {
    return { state: "error_recoverable" };
  },
};

export { fakeProjectionReducerTable, fakeProjectionValueProbe };
export type {
  FakeProjectionProbePassing,
  FakeProjectionProbeUnrelated,
  FakeProjectionProbeViolation,
  FakeProjectionProbeViolationProjectContext,
};
