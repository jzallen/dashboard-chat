# Software-Crafter Review — J-002 MR-3 (US-206 new-session lifecycle)

**Reviewer**: nw-software-crafter-reviewer (Haiku 4.5)
**Branch**: `deliver/project-and-chat-session-management-mr3`
**Base SHA**: `8fc80e4`
**Date**: 2026-05-13

## Verdict

**APPROVE** — ready to land via `gt mq submit`. Zero blockers; no major findings.

## Summary

MR-3 is a well-executed, focused implementation of the US-206 lazy-creation contract (DWD-10). The feature correctly implements three key behaviors:

1. Clicking "+ New Session" enters a welcome state with `session_id=null` and no backend write (validated by backend-row-count probe).
2. Sending the first message eagerly creates the session row via the `createSessionEagerly` invoke + PATCHes title from `first_message[:80]`.
3. Transient failures preserve composer text (`pending_first_message`) across `error_recoverable → retry_clicked → session_active_no_messages` per app-arch §6.4.

The design cleanly separates `session_active_no_messages` from `session_active` via the `creating_session_eagerly` invoke state. All 6 acceptance scenarios are present and pass against the local compose stack. 7 new unit tests (S14–S20) exercise the new states. The `priorState`-based event emission in the orchestrator (`session_active_reached` vs `session_resumed`) is the right call — it keeps the event log auditable while remaining functionally idempotent at the projection layer.

No test modifications, no testing theater, no internal class mocks. Iron Rule satisfied.

## Exit-Criteria Checklist

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | All 6 MR-3 scenarios are GREEN | ✓ | `pytest test_us206_*.py` shows 6/6 passing |
| 2 | No ghost session rows on navigate-away | ✓ | Scenario 3 asserts Q4 session-list count unchanged after welcome-state visit |
| 3 | Composer preserved across `error_recoverable → retry` | ✓ | Scenario 5 + unit S19 both verify pending_first_message survives the boundary |
| 4 | `harness.j002.{start_new_session, send_first_message}` callable | ✓ | Scenario 6 invokes both ops via node subprocess; passes |
| 5 | CM-A: no ui-state/lib imports in tests | ✓ | `grep -rE 'from .*ui-state/lib' tests/acceptance/project-and-chat-session-management/` returns 0 matches |
| 6 | Full regression (ui-state unit; prior J-002 acceptance; backend pytest) | ✓ | 82/82 ui-state unit; 30+6=36 J-002 acceptance; 1425 backend (1 pre-existing FHIR fail unrelated) |

## Design-Compliance Findings

All design contracts honored:

- ✓ `session_active_no_messages` state added ONLY in `session-chat.ts` (not `project-context.ts`) per DWD-13 SRP.
- ✓ `createSessionEagerly` invoke fires on `first_message_sent`; output assigns `session_id` and clears `pending_first_message`.
- ✓ `session_welcome_displayed` event carries `pending_first_message` in payload so the projection reducer preserves composer state across replay.
- ✓ `session_active_reached` distinguished from `session_resumed` via `priorState` parameter — eager-create path is auditable in event log.
- ✓ `error_recoverable.retry_clicked` has a third guard branch for `last_live_state === "session_active_no_messages"` (the new code path).
- ✓ `creating_session_eagerly` added to `TRANSIENT_STATES` in `waitForSettledState` — required for the invoke to settle before projection rebuild.
- ✓ Harness knob `X-Force-Create-Session-Failure` follows the established `X-Force-*` pattern (per-event header, consumed once).

## Test Theater Scan

**Acceptance scenarios (6/6 PASS)** — all derived directly from the Gherkin SSOT at `distill/features/us-206-*.feature`. Each asserts observable outcomes: machine state, projection context fields, backend session-count probes. No tautological assertions, no implementation-mirroring, no swallowed exceptions.

**Unit tests S14–S20 (7/7 PASS)** — all are port-to-port at the XState actor send/snapshot surface. S17 includes interaction verification (spy on actor call + content) alongside behavioral assertions on context — both flavors present, no over-coupling. S19 is a multi-state retry path that exercises the full failure→retry→success flow; high value.

## Potential Concerns Surfaced (NIT-level, not blocking)

- **N1**: The `session_active_reached` event handler in `projection.ts` and the `session_resumed` handler converge on the same `state: "session_active"`. The two differ only in payload shape and whether transcript/resource are pre-populated. This is intentional (per the in-line comment in `orchestrator.ts`) but a reader could mistake it for redundant code. The in-line comment is sufficient documentation; no action needed.

- **N2**: The frontend chat.tsx loader surfaces `pending_first_message` on `ChatLoaderData` but no React component yet consumes it. This is by design — the FE submit-handler rewire to dispatch `first_message_sent` lands in a future MR (per app-arch §6.4 "no new abstraction at MR-3"). The loader surface is forward-compatible.

- **N3**: Test budget per new behavior is nominally 2 unit tests; MR-3 lands 7 (S14–S20). However, each test exercises a distinct path (happy, idempotent reentry, cancel-via-session-click, eager-create success, eager-create failure, retry preservation, project-switch invalidation) — these are 7 distinct behaviors, not 7 parametrizations of one. Justified.

## Recommendation

**APPROVE and merge via `gt mq submit`.**

The implementation is focused, well-tested, and respects all design constraints. The composer-state preservation contract is the most subtle piece, and the implementation correctly threads `pending_first_message` from machine context → terminal event payload → projection reducer, with a clean test (S19) end-to-end.
