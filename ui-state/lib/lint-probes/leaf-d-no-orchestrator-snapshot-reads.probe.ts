// Probe for ADR-030 LEAF-D (no-orchestrator-snapshot-reads).
//
// This file is NOT executed. It is a static fixture that the plugin test
// suite at __tests__/rules.test.ts lints with the rule enabled to assert
// each violation pattern is flagged and each non-violation pattern is not.
//
// Pattern matches ADR-030's amendment §"Earned Trust principle 12": every
// lint rule comes with a probe that proves its coverage empirically.

interface FakeSnapshot {
  context: { project_id: string | null; session_list: string[] };
  getContext(): { project_id: string | null };
}

interface FakeProjection {
  context: { project_id: string | null };
}

// EXPECTED_VIOLATION — direct member access of snapshot.context.
function readSnapshotMember(snapshot: FakeSnapshot): string | null {
  return snapshot.context.project_id;
}

// EXPECTED_VIOLATION — bracket-notation access counts too.
function readSnapshotBracket(snapshot: FakeSnapshot): string | null {
  return snapshot["context"].project_id;
}

// EXPECTED_VIOLATION — method call to snapshot.getContext().
function readSnapshotMethod(snapshot: FakeSnapshot): string | null {
  return snapshot.getContext().project_id;
}

// EXPECTED_VIOLATION — destructuring from snapshot.context still reads
// snapshot.context first. The rule fires on the MemberExpression on the
// right-hand side, not the destructure shape.
function readSnapshotDestructure(snapshot: FakeSnapshot): string | null {
  const { project_id } = snapshot.context;
  return project_id;
}

// PASSING — reads from the projection are the legal pattern. The rule
// MUST NOT fire on `projection.context.x` even though it has the same
// shape as `snapshot.context.x`.
function readProjection(projection: FakeProjection): string | null {
  return projection.context.project_id;
}

// PASSING — local variables named `ctx` bound from projection.context are
// fine. The rule keys on the literal `snapshot` identifier; if you alias
// the projection's context to `ctx`, subsequent `ctx.foo` reads do not
// re-trigger the rule.
function readProjectionAlias(projection: FakeProjection): string | null {
  const ctx = projection.context;
  return ctx.project_id;
}

// PASSING — Direction F (ADR-028 amendment): branch-relevant data flows
// through event.output. The rule MUST NOT fire on event.output.x.
interface FakeEvent {
  output: { resume_target: string | null };
}
function readEventOutput(event: FakeEvent): string | null {
  return event.output.resume_target;
}

export {
  readEventOutput,
  readProjection,
  readProjectionAlias,
  readSnapshotBracket,
  readSnapshotDestructure,
  readSnapshotMember,
  readSnapshotMethod,
};
