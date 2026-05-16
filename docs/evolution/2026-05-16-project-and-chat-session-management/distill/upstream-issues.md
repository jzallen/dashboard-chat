# DISTILL — Upstream Issues for J-002

> **Wave**: DISTILL (J-002 — `project-and-chat-session-management`)
> **Date**: 2026-05-13
> **Owner**: nw-acceptance-designer
> **Purpose**: surface any HIGH-severity blockers DISTILL discovered that DESIGN or DISCUSS did not address. Per the nw-distill skill, this is the document where DISTILL flags genuine errors / contradictions it wants the user to resolve before DELIVER begins.

## Reconciliation result

DISTILL's pre-scenario reconciliation against DISCUSS (D1..D12) and DESIGN (DWD-1..DWD-12) returned **zero contradictions**. The two prior waves are consistent:

- DISCUSS D8 ("agent stays chat brain") is honored by DESIGN DWD-3 (`extractActiveScope` is an inline helper, not a parallel chat-state machine).
- DISCUSS D9 ("J-002 owns chat-session multi-turn state") is honored by DESIGN DWD-5 (`X-Active-Scope` header carries `resource_*` from J-002's projection).
- DISCUSS D11 ("dataset-context survives session resume") is resolved by DESIGN DWD-2 (Option A — column on session row).
- DISCUSS D10 ("no org-switching") is preserved — every DWD treats `org_id` as inherited from J-001, never mutated by J-002.

**Per the nw-distill skill, DISTILL proceeds to scenario writing without blocking on contradictions.**

## DESIGN's open items O1..O7 — validation

DESIGN's handoff §"Open items DISTILL may surface" listed O1..O7. DISTILL's validation:

| # | Item | DESIGN severity | DISTILL re-grading | Notes |
|---|---|---|---|---|
| O1 | Orchestrator `j001_ready` broadcast hook does not exist in live code | LOW | **LOW (unchanged)** | DELIVER MR-1 lands it (DWD-6 + RD1). Encoded as `test_journey_invariants::test_ic_j002_1_*` (un-skips at MR-1). |
| O2 | Cross-tab `/projection/stream` SSE endpoint does not exist today | MEDIUM | **MEDIUM (unchanged)** | DELIVER MR-2 lands the adapter `subscribe()` method per DWD-9 + RD2. Encoded as `test_us203::test_session_created_in_other_tab_refreshes_list_within_one_second` (un-skips at MR-2). If `XREAD BLOCK` is more complex than estimated, MR-2 scope slips by 1 day — bounded risk. |
| O3 | Custom ESLint rule for `X-Active-Scope` writer enforcement does not exist | LOW | **LOW (unchanged)** | DELIVER MR-4 task. Not an acceptance-test concern (a lint-time check, not a runtime invariant). |
| O4 | `tests/acceptance/project-and-chat-session-management/pyproject.toml` does not exist | LOW | **RESOLVED at DISTILL** | DISTILL writes the per-feature `pyproject.toml` (this MR). |
| O5 | Orchestrator's `replay_abandoned` event for J-002 specifically must be observable | LOW | **LOW (unchanged)** | DELIVER MR-6 exercises the existing surface; no new orchestrator code. Encoded as `test_us210::test_replay_buffer_timeout_transitions_to_error_recoverable`. |
| O6 | Exact sunset date for `SCOPE_HEADER_FALLBACK_ENABLED` is not literal yet | LOW | **LOW (unchanged)** | DELIVER MR-4 engineer sets the date. Encoded as `test_us208::test_compile_time_sunset_check_fails_agent_startup_after_date_with_flag_on` (the test sets a past date for the assertion). |
| O7 | Loader fan-out coordination with Phase 04 (slate crew, auth-proxy scaling) | MEDIUM | **MEDIUM (unchanged) — DELIVER MR-1 BLOCKER** | Praxis review §3 F-3 surfaced this; before MR-1 enters the queue, the slate crew (or its successor task tracker) must confirm Phase 04 auth-proxy capacity is final. Fallback: split MR-1 into 1a (machine + Redis-stream substrate) and 1b (root.tsx loader) — reduces Slice 1 to 4 loaders. The split is one ESM-export reshuffling; no AC changes. DISTILL does not pre-bake this split into `roadmap.json` (DD-6) but documents it here as the named escape hatch. |

**None of these are DISTILL blockers.** O7 is a coordination concern for the engineer landing MR-1 DELIVER — surface it to the slate crew before opening that MR.

## New issues DISTILL surfaced (none HIGH; logged for awareness)

### REC-1 (LOW) — `docs/product/kpi-contracts.yaml` missing

The K-J002-1..K-J002-6 instrumentation contract lives in
`docs/feature/project-and-chat-session-management/discuss/outcome-kpis.md`
but not at `docs/product/kpi-contracts.yaml` (the org-wide SSOT slot the
nw-distill skill checks for). DISTILL does not use a `@kpi` tag in this
suite because no acceptance scenario asserts a KPI metric event
directly — that's a DEVOPS sub-wave concern landing alongside Slice 4
per the DISCUSS handoff §"DEVOPS handoff".

**Action**: DEVOPS creates `docs/product/kpi-contracts.yaml` when the
K-J002-* instrumentation lands. No DISTILL action.

### REC-2 (LOW) — TS UserFlowHarness subprocess invocation pattern

DD-1 chose pytest+httpx+subprocess (not pytest-bdd / not cucumber-js).
The 10 `@harness @needs_ts_harness` scenarios drive the TS harness via
node subprocess. DELIVER's MR-1 engineer must decide whether to:

1. Add a small `harness_runner.ts` module under
   `tests/acceptance/user-flow-state-machines/` that the subprocess
   invokes with a JSON-shaped scenario spec on stdin and emits JSON on
   stdout (matches the J-001 cucumber `World` pattern).
2. Or invoke the harness module directly with an inline ESM script
   (driver.py's `run_ts_harness` shape).

Both work. DISTILL leaves the choice to MR-1 DELIVER per the
`@harness` scenarios' `requires_ts_harness` skip-guard — the contract
is "the harness namespace exists and is callable". The how is the
crafter's call.

### REC-3 (LOW) — Acceptance suite `pyproject.toml` not in `--auto` allowlist

Per CLAUDE.md "Workflow — trunk-based development": the `--auto` test
selector falls through to `--backend` (ruff + pytest) for any code
touch. The path
`tests/acceptance/project-and-chat-session-management/**` is NOT in the
`--auto` docs allowlist (matching `docs/**`, `.claude/**`, etc.). On a
DISTILL-only MR (docs + RED tests, no production code touched), the
gate runs `--backend` which:

- runs `cd backend && uv run ruff check` (passes — no backend changes)
- runs `cd backend && uv run pytest` (passes — backend tests unchanged)

The acceptance suite itself is NOT run by `--auto`. The 65 skip-marked
tests therefore have NO impact on the merge-queue gate. This is the
correct behavior: DISTILL produces RED tests + roadmap docs; DELIVER
runs the acceptance suite locally per MR.

**Action**: none. This is by design.

### REC-4 (LOW) — `tests/acceptance/<feature>/` is not in `--auto` docs allowlist

Restating REC-3 from a different angle: if a future MR touches the J-002
acceptance suite alongside production code, `--auto` will fall through
to `--backend` AND the local-only acceptance suite will not run. This is
acceptable for DISTILL → DELIVER:

- DISTILL ships the suite skip-marked → `--auto` GREEN.
- DELIVER's MR-N un-skips per the roadmap → DELIVER engineer runs the
  acceptance suite LOCALLY before submission and gates submission on it.
  The local run command is documented in the suite README.

This mirrors the J-001 + `frontend-coexistence` SKIPPED-suite-pattern.

## Conclusion

**No upstream blockers.** DISTILL proceeds to handoff. DESIGN's O1..O7 are valid; DISTILL escalates only O7 (loader fan-out coordination with Phase 04) as the named pre-DELIVER-MR-1 coordination concern. The two Praxis-deferred findings F-4 + F-5 are resolved at DISTILL per DD-4 + DD-5 and encoded as explicit scenarios.
