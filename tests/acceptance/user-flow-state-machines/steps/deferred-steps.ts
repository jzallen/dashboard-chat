// Deferred step definitions — placeholders for all @skip scenarios.
//
// One Cucumber rule (and the skill's "one scenario enabled at a time" rule):
// every step phrase referenced in a feature file MUST resolve to a step
// definition or the suite fails at collection time. To honor BOTH rules,
// scenarios past the walking skeleton are tagged @skip (so they don't run)
// AND their step phrases resolve here to `throw new Error('not enabled')`.
//
// DELIVER's first action for each roadmap step is:
//   1. Remove the @skip tag from the relevant scenarios.
//   2. Move the matching step definitions from this file into a dedicated
//      file per slice (slice-2-recoverable-error.steps.ts, etc.).
//   3. Implement the bodies outside-in.

// All step bodies previously defined here have been moved to per-slice files
// as each DELIVER step lands. This file is intentionally empty (no exports)
// so Cucumber's autoload still picks it up without any side effects. The
// comments below preserve the trail of moves for future archaeology.

// --------------------------------------------------------------------------
// Slice 1 — error paths
// --------------------------------------------------------------------------









// --------------------------------------------------------------------------
// Slice 1 — scope resolver invariants
// (Step 01-03 moved these into steps/scope-resolver.steps.ts.)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Slice 2 — recoverable error UX
// (Step 02-01 moved these into steps/recoverable-error.steps.ts.
//  Scenarios remain @skip until the Cucumber acceptance suite is
//  stabilized for headless execution — see DI-1 in
//  docs/feature/user-flow-state-machines/deliver/upstream-issues.md.)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Slice 2 — harness drives transitions (US-004)
// (Step 02-02 moved these into steps/harness-drives.steps.ts.
//  Scenarios remain @skip until the Cucumber acceptance suite is
//  stabilized for headless execution — see DI-1 in
//  docs/feature/user-flow-state-machines/deliver/upstream-issues.md.)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Slice 3 — expired token freeze + replay (US-005)
// (Step 03-01 moved these into steps/expired-token.steps.ts.
//  Scenarios remain @skip until the Cucumber acceptance suite is
//  stabilized for headless execution — see DI-1 in
//  docs/feature/user-flow-state-machines/deliver/upstream-issues.md.)
// --------------------------------------------------------------------------

// --------------------------------------------------------------------------
// Journey invariants (US-006 IC-1..IC-6)
// (Step 03-01 moved these into steps/journey-invariants.steps.ts.
//  Scenarios remain @skip until the Cucumber acceptance suite is
//  stabilized for headless execution — see DI-1 in
//  docs/feature/user-flow-state-machines/deliver/upstream-issues.md.)
// --------------------------------------------------------------------------
