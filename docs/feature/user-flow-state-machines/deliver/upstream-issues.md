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

- Surfaced in: Step 02-01 (Slice 2 recoverable error UX)
- Symptom: the 7-service compose stack plus the Cucumber harness is too
  fragile to run reliably in the headless DELIVER environment for the
  current dispatch budget. Acceptance test verification was deferred to
  vitest unit suites for Step 02-01 per Overseer directive.
- Impact: the five @us-003 scenarios in
  `tests/acceptance/user-flow-state-machines/features/slice-2-recoverable-error.feature`
  remain `@skip`. Step glue has been moved out of `deferred-steps.ts`
  into `recoverable-error.steps.ts` so a future run can flip the tags
  and execute without rewriting.
- Resolution path: separate ticket to stabilize the headless compose +
  Cucumber harness (the eventual fix lands in a Slice 4-style ops ticket
  outside this feature's DELIVER scope). When that ticket lands, remove
  the `@skip` tags from the five @us-003 scenarios and re-run.
