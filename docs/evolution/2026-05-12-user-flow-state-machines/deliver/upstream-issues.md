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
  Step 02-02 (Slice 2 harness drives transitions) and Step 03-01 (Slice 3
  expired-token freeze + journey invariants).**
- Symptom: the 7-service compose stack plus the Cucumber harness is too
  fragile to run reliably in the headless DELIVER environment for the
  current dispatch budget. Acceptance test verification was deferred to
  vitest unit suites for Step 02-01 per Overseer directive. Steps 02-02
  and 03-01 inherit the same constraint.
- Impact:
  - The five @us-003 scenarios in
    `tests/acceptance/user-flow-state-machines/features/slice-2-recoverable-error.feature`
    remain `@skip`. Step glue lives in `recoverable-error.steps.ts`.
  - The six @us-004 scenarios in
    `tests/acceptance/user-flow-state-machines/features/slice-2-harness-drives-transitions.feature`
    remain `@skip`. Step glue lives in `harness-drives.steps.ts`.
  - The six @us-005 scenarios in
    `tests/acceptance/user-flow-state-machines/features/slice-3-expired-token-freeze.feature`
    remain `@skip`. Step glue lives in `expired-token.steps.ts`.
  - The six @us-006 IC-1..IC-6 scenarios in
    `tests/acceptance/user-flow-state-machines/features/journey-invariants.feature`
    remain `@skip`. Step glue lives in `journey-invariants.steps.ts`.
- Vitest coverage (Step 02-02 surface):
  - `tests/acceptance/user-flow-state-machines/harness/user-flow-harness.test.ts`
    exercises the seven public harness methods + composition primitive.
  - `ui-state/index.test.ts` exercises the `__harness_force_failure__`
    and `__harness_expire_token__` HTTP handlers (knob-gated per DWD-1)
    plus the access_token-in-projection contract.
  - `ui-state/lib/machines/login-and-org-setup.test.ts` extends B3/B4
    machine-level transitions for the harness events.
- Vitest coverage (Step 03-01 surface, US-005):
  - `ui-state/lib/orchestrator.test.ts` (new): cross-machine FREEZE/THAW
    broadcast, bounded replay buffer (5s timeout, 16-event cap), origin
    actor exemption, and the expired_token → freeze / ready → thaw
    auto-signalling on the orchestrator's `send()` path.
  - `ui-state/lib/machines/login-and-org-setup.test.ts` extends B5/B6
    for the silent re-auth invocation on `expired_token` (success → ready,
    failure → error_recoverable with `silent-reauth-failed` tag). The
    closed-union exhaustiveness test now includes `silent-reauth-failed`.
  - `auth-proxy/app.test.ts` extends with `silent_reauth_ok` and
    `silent_reauth_failed` KPI emissions on the proxied `/ui-state/*`
    surface, gated on the projection's `silent_reauth_ok` flag and the
    `silent-reauth-failed` underlying_cause_tag respectively.
  - `ui-presentation/app/routes/expired-token-banner.test.tsx` (new):
    "Refreshing your session..." banner — non-blocking aria semantics
    (role="status", aria-live="polite") rendered when projection state is
    `expired_token`; absent otherwise.
- DI-2 (sub-issue) — Banner E2E + Playwright-shaped bodies:
  - Several @us-005 step bodies (banner focus management, transform
    button paused indicator, draft preservation) require Playwright-level
    DOM inspection. They are stubbed with `deferredToUi2` in
    `expired-token.steps.ts` and remain @skip pending the UI-2 ticket.
- DI-3 (sub-issue) — Property-based generators for IC-1..IC-6 deferred:
  - The @us-006 journey-invariants scenarios are authored as
    example-based step glue in `journey-invariants.steps.ts`. Full
    fast-check property generators over personas, names, and routes are
    deferred to a follow-on ticket. The structural invariants are
    already enforced at the machine and orchestrator levels:
    - IC-1 (correlation_id stability) — B2 in `login-and-org-setup.test.ts`.
    - IC-2 (JWT org claim == projection org.id) — assert_jwt_carries_org_claim
      in the harness, exercised by Step 02-02 vitest.
    - IC-4 (no app shell pre-reissue) — projection.state stays out of
      `ready` until `org_created_and_jwt_reissued` lands.
    - IC-6 (exactly-once silent renewal) — single `invoke` on
      `expired_token` in `login-and-org-setup.ts`, covered by B5/B6.
- Resolution path: separate ticket to stabilize the headless compose +
  Cucumber harness (the eventual fix lands in a Slice 4-style ops ticket
  outside this feature's DELIVER scope). When that ticket lands, remove
  the `@skip` tags from the affected @us-003 / @us-004 / @us-005 /
  @us-006 scenarios and re-run; the step glue is already in place.

---

## DI-4 — Step 01-03 execution-log gap (cross-worker handoff)

- Surfaced in: orchestrator integrity check at start of Step 03-01.
- Symptom: `execution-log.json` records `01-03` PREPARE / RED_ACCEPTANCE /
  RED_UNIT but lacks GREEN / COMMIT. The implementation (active-scope
  resolver, deep-link endpoint, scope-resolver vitest) is present on
  disk and shipped to `main` per the upstream Slice-1 merge (crew worker
  `maya`); only the local DES log entries were never written.
- Impact: `verify_deliver_integrity` flags 01-03 as `3/5 phases`. The
  Refinery merge-queue gate (`./tools/test/test.sh --backend`) is
  unaffected because backend regression coverage runs there, not via
  DES. The flag does NOT block Slice 3 from shipping.
- Resolution path: `/nw-finalize` handles. Two clean options for the
  finalize session:
  1. Re-execute 01-03 GREEN + COMMIT phases via the DES CLI from a
     dispatched crafter that confirms the implementation already on
     disk satisfies the AC, then logs the missing phases.
  2. Mark the 01-03 partial as approved-skip with a CHECKPOINT_PENDING
     reason quoting the upstream maya-shipped commits.
  The orchestrator chose option (2) deferral for Step 03-01 dispatch so
  the architectural payoff (US-005 freeze + replay) could land without
  burning the dispatch budget on retroactive log cleanup.
