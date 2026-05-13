# Slice 1 — Walking skeleton: Active scope resolves to a project

> **Wave**: DISCUSS — `project-and-chat-session-management` (J-002)

## Goal

After J-001 `ready`, J-002 resolves `active_scope.project_id` for
the user and the FE app shell paints the project chip on first
paint — for the no-projects case (US-201), the returning-user
last-used case (US-202), and the cold deep-link case (US-204
happy + cross-tenant failure).

## IN scope

* J-002 states: `resolving_initial_scope`,
  `no_projects_empty_state`, `creating_project`, `project_selected`,
  `scope_mismatch_terminal`.
* ScopeResolver invariants 1+4 (JWT-claim parity + cross-tenant
  rejection per ADR-029 §1).
* Last-used resolution algorithm (most-recent `last_active_at`
  across user's projects).
* Remix loader at `app/root.tsx` reading J-002's projection.
* App shell project-chip rendering from the projection (extends
  J-001 K2 to project chip).

## OUT scope

* Session list, session resume, new session lifecycle.
* Project switching (mid-session), dataset context switching.
* Agent X-Active-Scope contract enforcement.
* Cross-machine FREEZE/THAW participation.

## Stories

* **US-201**: First-time-in-org user lands in
  `no_projects_empty_state`.
* **US-202**: Returning user lands in last-used project's
  `session_list_visible` (we ship `project_selected` →
  `session_list_visible` together but the latter renders an empty
  skeleton; Slice 2 fills it).
* **US-204**: Cold deep-link to a project resolves
  `active_scope.project_id` before page paint; cross-tenant
  surfaces named-diagnostic.

## Learning hypothesis

* **Disproves if it fails**: that the J-002 machine can compose
  with J-001 cleanly via the orchestrator (cross-machine signaling,
  shared projection shape) — OR that the last-used resolution
  algorithm is correct.
* **Confirms if it succeeds**: J-002's projection is a faithful
  consumer/producer of `active_scope`; the substrate amortizes
  to a second machine without modification.

## Acceptance criteria (slice-level)

* [ ] Returning user with ≥1 project: `active_scope.project_id`
  matches the user's last-used project at p99; first-paint
  latency ≤800ms.
* [ ] First-time-in-org user: `no_projects_empty_state` is
  reached with the welcoming copy; "Create project" CTA works
  end-to-end into `project_selected`.
* [ ] Cold deep-link to a valid project: `project_selected` is
  entered with the project chip painted on first paint at p95
  ≤300ms (per ADR-029 invariant 4 budget).
* [ ] Cold deep-link to a cross-tenant project:
  `scope_mismatch_terminal` is reached with the named-diagnostic
  panel; no project-chip flicker with the cross-tenant name.
* [ ] TS harness exposes `harness.j002.assert_initial_project()`,
  `harness.j002.open_deep_link()`, `harness.j002.create_first_project()`.

## Dependencies

* **Upstream**: J-001 DELIVER complete (ratified 2026-05-12; in
  place).
* **Substrate**: ADR-027/028/029/030 in place. J-002 plugs into
  `ui-state/index.ts:29-60` orchestrator registration.
* **Backend**: `list_projects`, `create_project`, `get_project`,
  `list_sessions` (one-call per project for last-used resolution).
  All exist.

## Effort estimate

* ~1 day (3 stories × ~0.3 days). The substrate is amortized;
  this slice is mostly J-002 state-machine logic + Remix loader
  wiring.

## Pre-slice SPIKE (if any)

None needed. The substrate is proven by J-001; the J-002 state
machine is small and well-bounded.

## Dogfood moment

A developer who has access to multiple projects opens a fresh
browser tab, signs in, observes the project chip paint with
their most-recent project on first paint.

## Production-data check

The "last-used resolution algorithm" reads `last_active_at` from
real session rows in the dev backend's session table. Not
synthetic.

## Carpaccio taste tests

* "Ship 4+ new components"? No — 1 machine + 1 loader + 1
  empty-state panel + 1 scope-mismatch panel = 4. ON the line;
  Let me reframe: the machine + the loader is 2 pieces of
  scaffolding; the two panels are the user-visible "components."
  Acceptable.
* "Depends on a new abstraction"? No.
* "Disproves a pre-commitment"? Yes — the last-used algorithm.
* "Synthetic data only"? No.
* "Identical to another slice at scale"? No.
