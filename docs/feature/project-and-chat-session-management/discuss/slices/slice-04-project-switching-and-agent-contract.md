# Slice 4 — Project switching + agent scope contract

> **Wave**: DISCUSS — `project-and-chat-session-management` (J-002)

## Goal

A user switches projects (via nav, deep link, or Projects grid)
and the FE shell + session list + chat dispatch atomically retarget
to the new project. AND every chat-agent invocation carries
`X-Active-Scope` from J-002's projection; the agent rejects turns
missing scope with 400.

This slice is **load-bearing for the JOB-002 outcome O2** (UI/harness
divergence) because it is the first slice to validate that the
agent's scope-contract is wired end-to-end — closing the
cross-tenant data-leak surface from
`agent/lib/chat/handleChat.ts:75`.

## IN scope

* J-002 state: `switching_project` (with `session_id` +
  `resource_*` invalidation on entry).
* FE SSE cancellation contract: in-flight chat-turn streams from
  the old project's `session_active` are closed before the new
  project's loader runs.
* Agent middleware enforcement of `X-Active-Scope` header (per
  ADR-029 §4): 400 on missing org_id/project_id; 403 on
  mismatched org_id-vs-JWT.
* `uiStateClient` helper sets `X-Active-Scope` on every
  outgoing fetch to agent + backend.
* Backwards-compat migration window: agent falls back to body's
  `project_id` for one release, emits `scope_header_fallback_used`
  log event, then removes the fallback.

## OUT scope

* Dataset context switching (Slice 5).
* FREEZE/THAW (Slice 6).

## Stories

* **US-207**: User switches projects within an org — scope
  atomically retargets; in-flight chat-turn cancelled.
* **US-208**: Chat-agent invocation carries `active_scope` from
  J-002's projection; agent rejects missing scope.

## Learning hypothesis

* **Disproves if it fails**: that the SSE cancellation contract
  + agent middleware enforcement together can close the
  cross-tenant data-leak surface. If ANY observed agent request
  carries a mismatched `(project_id, session_id)` pair after this
  slice ships, the contract is broken.
* **Confirms if it succeeds**: the canonical ChatView
  project-context race named at `adr-027:14` is mechanically
  retired for the first time; the agent has a hardened contract
  that scales to J-003+ flows without modification.

## Acceptance criteria (slice-level)

* [ ] Project switch (US-207): atomic chip + session list paint;
  in-flight chat-turn SSE stream closed BEFORE new project's
  loader runs; agent never receives a turn with mismatched
  `(old session_id, new project_id)`.
* [ ] Agent middleware (US-208): rejects missing `org_id` →
  400 with named diagnostic; rejects missing `project_id` → 400;
  rejects mismatched `org_id` vs JWT → 403.
* [ ] FE: 100% of FE-originated chat-agent POSTs carry
  `X-Active-Scope` populated from J-002's projection at p99.
* [ ] Backwards-compat: legacy body-project_id callers continue
  to work during the one-release migration window, emit
  `scope_header_fallback_used` log; after window closes, body
  field is removed.
* [ ] TS harness: `harness.j002.switch_project()` AND
  `harness.j002.assert_agent_received_scope(turn_index)`.

## Dependencies

* **Upstream**: Slices 1-3 (project_selected, session_list_visible,
  session_active are all entry-points for `switching_project`).
* **Agent code**: `agent/lib/chat/handleChat.ts` middleware changes.
* **FE code**: `uiStateClient` helper extension (per ADR-029 §2
  Option D).

## Effort estimate

* ~2 days (2 stories × ~1 day each).

## Pre-slice SPIKE

**Agent middleware compatibility check**: Verify that the existing
`DatasetLayerHarness` Python integration tests can be migrated
to set `X-Active-Scope` before the backwards-compat fallback is
removed. Identify any acceptance test under `tests/acceptance/**/`
that currently passes `project_id` in the body — they're the
migration-tracking dataset.

Estimated SPIKE effort: ~2 hours; landing the migration window
flag (`SCOPE_HEADER_FALLBACK_ENABLED`) is part of US-208 itself.

## Dogfood moment

A developer rapidly clicks between Q3 Sales and Q4 Analytics while
typing in chat input. No orphan request shows up in the agent's
request log with a mismatched project_id / session_id pair.

## Production-data check

Real agent middleware running against real chat requests; real
project + session rows in the dev backend.

## Carpaccio taste tests

* "Ship 4+ new components"? No — middleware + machine state +
  `uiStateClient` helper extension = 3.
* "Depends on a new abstraction"? Slightly — the
  `uiStateClient` helper is new, but it's specified in
  ADR-029 §2 and is small.
* "Disproves a pre-commitment"? Yes — the atomic-switching
  promise.
* "Synthetic data only"? No — real agent requests.
* "Identical to another slice at scale"? No.
