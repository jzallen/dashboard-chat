# Upstream issues — user-flow-state-machines DELIVER

Issues surfaced during DELIVER that block future steps or need follow-up
tickets. Each entry records:

- DI-N — unique id
- Surfaced in: which step exposed it
- Symptom: what we observed
- Impact: what is gated by it
- Resolution path: who/where it gets fixed

---

## DI-1 — Cucumber acceptance suite not executable headlessly

- Surfaced in: Step 02-01 (Slice 2 recoverable error UX). **Extended in
  Step 02-02 (Slice 2 harness drives transitions).**
- Symptom: the 7-service compose stack plus the Cucumber harness is too
  fragile to run reliably in the headless DELIVER environment for the
  current dispatch budget. Acceptance test verification was deferred to
  vitest unit suites for Step 02-01 per Overseer directive. Step 02-02
  inherits the same constraint.
- Impact:
  - The five @us-003 scenarios in
    `tests/acceptance/user-flow-state-machines/features/slice-2-recoverable-error.feature`
    remain `@skip`. Step glue lives in `recoverable-error.steps.ts`.
  - The six @us-004 scenarios in
    `tests/acceptance/user-flow-state-machines/features/slice-2-harness-drives-transitions.feature`
    remain `@skip`. Step glue lives in `harness-drives.steps.ts`.
- Vitest coverage (Step 02-02 surface):
  - `tests/acceptance/user-flow-state-machines/harness/user-flow-harness.test.ts`
    exercises the seven public harness methods + composition primitive.
  - `flow-state/index.test.ts` exercises the `__harness_force_failure__`
    and `__harness_expire_token__` HTTP handlers (knob-gated per DWD-1)
    plus the access_token-in-projection contract.
  - `flow-state/lib/machines/login-and-org-setup.test.ts` extends B3/B4
    machine-level transitions for the harness events.
- Resolution path: separate ticket to stabilize the headless compose +
  Cucumber harness (the eventual fix lands in a Slice 4-style ops ticket
  outside this feature's DELIVER scope). When that ticket lands, remove
  the `@skip` tags from the affected @us-003 and @us-004 scenarios and
  re-run; the step glue is already in place.
