# J-002 `mr_1` / `mr_2` / `mr_3` — Root-Cause Analysis & Per-Test Triage

> **Type**: Explanation / Analysis (DIVIO)
> **Date**: 2026-05-17
> **Branch**: `rca/j002-mr123` (HEAD `707079a`, post-ADR-040 LEAF-2)
> **Scope**: READ-ONLY RCA of the pre-existing RED acceptance cluster at
> `tests/acceptance/project-and-chat-session-management/`, markers
> `mr_1` / `mr_2` / `mr_3`. No code, test, or stack mutated.
> **Out of scope** (proven GREEN by the overseer, not re-derived here):
> `mr_4` / `mr_5` / `mr_6` (14/0 · 7/0 · 8/0 at the FINALIZE baseline).

---

## 1. Executive summary

`mr_1`/`mr_2`/`mr_3` are **not flaky, not pollution, not an ADR-040
regression** — confirmed by solo fresh-process runs (every cluster
reproduces identically in isolation; §3). They are a genuine
**acceptance-debt** cluster: the J-002 DELIVER roadmap
(`distill/handoff-distill-to-deliver.md:108-170`) mandated MR-1/2/3
scenarios GREEN, but FINALIZE only ever asserted MR-4/5/6
(`FINALIZE.md:19-35`). MR-1/2/3 shipped *code* without their
acceptance spec ever passing.

**32 isolation-stable failures** across the three markers, classified:

| Bucket | Count | One-line characterization |
|---|---:|---|
| **GENUINE-UNIMPLEMENTED** | **23** | In-AC behavior the roadmap scheduled GREEN; never wired end-to-end. |
| **DEFERRED-BY-DESIGN** | **3** | Asserts a J-002-internal detail an explicit wave-decision/OQ carved out or left open. |
| **ENVIRONMENTAL** | **6** | `tsx` not installed in the harness package + driver strips subprocess env. |
| **TEST-OVER-SPEC** | **0** | (No pure case; documented as *secondary dissent* on the 3 DEFERRED — overseer decides.) |

Two production root causes account for 22 of the 23 GENUINE failures:

- **RC-1 (mr_1, deep-link + projection emission)**: a post-settle
  `open-deep-link` does not re-run scope resolution with the intent,
  so cross-tenant / deleted-project / cold deep-links collapse to
  `no_projects`; and resolver-computed diagnostics
  (`most_recent_session_per_project`, `last_used_resolution_degraded`)
  are never emitted into the projection.
- **RC-2 (mr_2 + mr_3, session-chat)**: the `session-chat` sibling
  machine receives the project broadcast but its `loadSessionList`
  actor errors against the real backend (user identity is **not**
  propagated to session-chat — `user.email`/`user.first_name` are
  `null` in its context), so it lands in `error_recoverable` /
  `underlying_cause_tag="transient"` and **never reaches
  `session_list_loaded`**. Every mr_2/mr_3 test funnels through the
  `_spawn_j002_and_wait_session_list` precondition helper, so the
  entire cluster fails at that gate.

---

## 2. Method & evidence base

- Suite run read-only from
  `tests/acceptance/project-and-chat-session-management/` via
  `uv run --no-project --with httpx --with pyyaml --with pytest … pytest`
  (the suite venv was unmaterialized; `--with` supplies the declared
  deps without mutating the tree).
- Combined `-m "mr_1 or mr_2 or mr_3"`: **23 failed / 13 passed / 29
  deselected**. The 13 "passed" are an artifact of favorable
  cross-test data seeding (mr_1 seeds projects/sessions that let
  later mr_2/3 helpers transiently pass). **Solo per-file fresh
  processes** are the true signal and yield **32 stable failures**
  (§3) — this report enumerates the solo truth.
- Live read-only probes against the shared healthy stack
  (auth-proxy :1042) characterized the actual machine states.
- SSOT read: `docs/evolution/2026-05-16-project-and-chat-session-management/`
  (`FINALIZE.md`, `discuss/wave-decisions.md`, `discuss/dor-validation.md`,
  `discuss/stories/US-201..206.md`, `distill/handoff-distill-to-deliver.md`,
  `design/application-architecture.md`) + ADR-027/028/029/030/040.
- Production trace: `ui-state/index.ts`, `ui-state/lib/orchestrator.ts`,
  `ui-state/lib/projection.ts`, `ui-state/lib/machines/project-context/`
  + `session-chat/machine.ts`.

### 2.1 Stack health note

The shared compose stack is **healthy** for this RCA's purposes:
`begin` → `project_selected` resolves a real project with
`first_name:"Maya"` correctly populated in the project-context
projection (live probe). The failures below are product/spec gaps,
not stack outages.

---

## 3. Isolation proof (not flake / not pollution / not ADR-040)

| Cluster | Solo fresh-process result | Signature |
|---|---|---|
| `mr_1` (`-m mr_1`) | 14 failed / 4 passed / 47 deselected | stable; identical assertion lines |
| `test_us203…` solo | 5/5 failed | `final state='error_recoverable'` |
| `test_us205…` solo | 4/4 failed | `session-chat never reached session_list_loaded` |
| `test_us206…` solo | 5/5 failed | `session-chat never reached session_list_loaded` |
| `test_journey_invariants…` solo | IC-J002-2 + IC-J002-3 failed | identical to combined |

Representative failures (`test_us202::…most_recent_session`,
`test_us204::…cross_tenant`) reproduce byte-identically solo. ADR-040
LEAF-1/2 are routing-only (`git log -- ui-state/` shows only `707079a`
on this branch) and exonerated by the overseer's pre-LEAF (`990c812`)
experiment. Conclusion: **pre-existing, deterministic, product/spec
debt** — consistent with the overseer's established evidence.

---

## 4. Per-test triage

Citations are `file:line` at HEAD `707079a`. AC quotes are from the
J-002 DISCUSS stories (binding executable spec at DISTILL; the
`roadmap.json` `scenarios_to_unskip` is "the binding contract" —
`distill/handoff-distill-to-deliver.md:54`).

### 4.1 `mr_1` — Slice 1 (US-201, US-202, US-204 + IC-J002-1/2)

Roadmap MR-1 scope: "18 scenarios … US-201's 5, US-202's 5, US-204's
6, plus `test_ic_j002_1_*` and `test_ic_j002_2_*`" with exit criterion
"**All 18 MR-1 scenarios are GREEN**"
(`distill/handoff-distill-to-deliver.md:128-141`). 14 fail solo (11
functional + 3 ENVIRONMENTAL); 4 pass.

| Test (`file::test`) | Assert | Observed | Bucket | Rationale (cite) |
|---|---|---|---|---|
| `test_us201…::test_first_sign_in_foregrounds_the_no_projects_welcome_panel` | `:187` `"Maya" in page.body` (SSR `/`) | state token present, first-name absent | **GENUINE-UNIMPLEMENTED** | US-201 AC mandates `"Welcome to ${org.name}, ${user.first_name}!"` (`US-201.md:172-176`); it is the MR-1 walking-skeleton GREEN-gate scenario (`handoff-distill-to-deliver.md:32`). Projection carries `first_name:"Maya"` (live probe) → the FE root/SSR loader (DWD-4) never surfaces it on first paint. |
| `test_us201…::test_creating_first_project_lands_in_project_selected` | `:246` `project_selected` + non-null `active_scope.project_id` after `create_project_submitted` | never settles as asserted | **GENUINE-UNIMPLEMENTED** | US-201 AC: "Clicking 'Create project' … transitions through `creating_project` to `project_selected`" (`US-201.md:178-181`); roadmap MR-1 mandates US-201's 5 GREEN. The `create_project_submitted` → `creating_project` path is not wired. *Contributing*: wave-decision D6 ambiguity (§5). |
| `test_us201…::test_empty_project_name_keeps_machine_in_no_projects` | `:295` `context.project_validation_error.kind=="empty"` | key absent | **DEFERRED-BY-DESIGN** | Asserts a **J-002-internal validation state** that wave-decision **D6 explicitly carves OUT**: "J-002 does NOT carry validation, naming, or deletion-confirmation state internally" (`discuss/wave-decisions.md:162-166`). Conflicts with US-201 AC (`US-201.md:182-185`) — unresolved DISCUSS-internal contradiction; test should have been skip-marked pending reconciliation. *Secondary*: TEST-OVER-SPEC. |
| `test_us201…::test_transient_create_project_failure_lands_in_error_recoverable_with_composer_preserved` | `:343` `error_recoverable` + `underlying_cause_tag=="transient"` + `pending_project_name` | `state=='no_projects'`, tag `'no_projects'` | **DEFERRED-BY-DESIGN** | Asserts J-002-internal create-failure/retry state — same D6 carve-out (`discuss/wave-decisions.md:162-166`). Also depends on a production fault-injection contract (`X-Force-Create-Project-Failure` header) that was never built. Conflicts with US-201 AC (`US-201.md:186-188`) — flag for reconciliation. *Secondary*: TEST-OVER-SPEC. |
| `test_us202…::test_resolution_picks_project_carrying_most_recent_session` | `:126` `selected==q4_id` (**passes**) **+** `:133` `q4_id in context.most_recent_session_per_project` (**fails**, `keys=[]`) | core resolution correct; map `{}` | **DEFERRED-BY-DESIGN** | Core US-202 AC ("selects the last-used project", `US-202.md:167-184`) **works**. The failing assertion targets the `most_recent_session_per_project` **read shape** = **OQ-J002-5**, recorded "tracked for DESIGN" (`dor-validation.md:58`) and "non-blocking — DESIGN owns them but they don't gate any slice" (`dor-validation.md:269`); US-202 technical note: "DESIGN owns the read shape (OQ-J002-5)" (`US-202.md:207-208`); the test comment itself cites `(OQ-J002-5)` (`test_us202…:131`). **Dissent**: `design/application-architecture.md:1078` later specs the field "Populated By `resolving_initial_scope` exit" → arguably GENUINE. Unreconciled DISCUSS↔DESIGN delta; overseer decides. |
| `test_us202…::test_transient_list_sessions_failure_during_last_used_resolution_emits_degraded_event` | `:417` `context.last_used_resolution_degraded` populated (`partial_result`, `failed_project_ids`) | `None` | **GENUINE-UNIMPLEMENTED** | US-202 AC explicitly: transient `list_sessions` failure "emits `last_used_resolution_degraded` but DOES NOT block sign-in" (`US-202.md:176`); confirmed in-AC via OQ-J002-4 (`dor-validation.md:269`, "US-202 commits to partial-result"). Live probe: `last_used_resolution_degraded:null`; the degraded-emission path + its `X-Force-List-Sessions-Failure` fault-injection contract were never built. |
| `test_us204…::test_cold_deep_link_to_project_resolves_active_scope_before_paint` | `:150` `active_scope.project_id == deep-linked id` (SSR `/projects/:id`) | resolves a **different** project id | **GENUINE-UNIMPLEMENTED** | US-204 AC: cold deep-link resolves `active_scope` to the intent project before paint (`US-204.md:207-232`); roadmap MR-1. SSR loader path does not honor `intent_project_id`. |
| `test_us204…::test_cross_tenant_deep_link_lands_in_scope_mismatch_terminal` | `:202` `scope_mismatch_terminal` + `underlying_cause_tag=="cross_tenant"` | `'no_projects'` | **GENUINE-UNIMPLEMENTED** | US-204 AC mandates the closed-vocabulary cause discriminator incl. `cross_tenant` (`US-204.md:220-232`; `design/application-architecture.md:169-173`). The deep-link 403/404 fast-path exists in the resolver but a **post-settle** `open-deep-link` (machine already in `no_projects`) does not re-resolve with intent → collapses to `no_projects`. **RC-1**. |
| `test_us204…::test_deep_link_to_deleted_project_surfaces_same_panel_with_project_not_found_cause` | `:239` `underlying_cause_tag=="project_not_found"` | `'no_projects'` | **GENUINE-UNIMPLEMENTED** | Same as above; US-204 AC requires `project_not_found` (`US-204.md:114, 220-232`). **RC-1**. |
| `test_us204…::test_deep_link_with_intent_resource_carries_through_to_session_active` | `:349` `project_selected` + `active_scope.project_id==project_id` (+ intent_resource in ctx) | `active_scope.project_id == None` | **GENUINE-UNIMPLEMENTED** | US-204 AC: deep links carrying `intent_resource_id` materialize `active_scope` with `project_id` AND `resource_*` on first paint (`US-204.md:207-232`). SSR `/projects/:id/datasets/:id` route does not resolve `project_selected`; intent fields not materialized. **RC-1**. |
| `test_journey_invariants_j002.py::test_ic_j002_2_project_selected_entry_has_non_null_authorized_project_id` | `:222` non-null `active_scope.project_id` on `project_selected` (after `create_project_submitted`) | `None` | **GENUINE-UNIMPLEMENTED** | IC-J002-2 scheduled MR-1 (`test_journey_invariants_j002.py:19`); core ADR-029 §1 invariant. Fails on the same unwired `create_project_submitted` → `project_selected` path as `test_creating_first_project`. |

ENVIRONMENTAL in `mr_1` (3): `test_us201…::test_ts_harness_drives_no_projects_path_end_to_end`,
`test_us202…::test_ts_harness_asserts_initial_project_resolution`,
`test_us204…::test_ts_harness_drives_deep_link_resolution_for_both_happy_and_cross_tenant` — see §4.4.

### 4.2 `mr_2` — Slice 2 (US-203 session list, US-205 resume, IC-J002-3)

Roadmap MR-2: "12 total: US-203's 6, US-205's 5, `test_ic_j002_3_*`",
exit "All 12 MR-2 scenarios GREEN"
(`distill/handoff-distill-to-deliver.md:152-159`). **All 12 fail in
isolation** (10 functional + 2 ENVIRONMENTAL). Every functional test
funnels through the precondition helper
(`test_us203…:118-131 _wait_for_session_chat_state`,
`test_us205…:128 _spawn_j002_and_wait_session_list`,
`test_journey_invariants…:355`) which waits for the **session-chat**
machine to reach `session_list_loaded`.

**RC-2 (single root cause for the cluster)**: live probe of
`/ui-state/flow/session-chat/projection?flow_id=session-chat:dev-user-001`
after `begin` shows `state:"error_recoverable"`,
`underlying_cause_tag:"transient"`, `project:{…Q4 Analytics}` (the
project broadcast arrived) but `user:{email:null, first_name:null}` —
**identity is not propagated** project-context → orchestrator →
session-chat, so its `loadSessionList` actor fails the backend call
and the machine drops to `error_recoverable` instead of
`session_list_loaded` (the `session_list_loaded` state and
`loadSessionList` actor exist in `ui-state/lib/machines/session-chat/machine.ts`,
but the read never succeeds end-to-end).

| Test | Bucket | Rationale |
|---|---|---|
| `test_us203…::test_session_list_renders_sorted_most_recent_first` (`:162`) | **GENUINE-UNIMPLEMENTED** | US-203 AC: on `project_selected`, fire `list_sessions` → `loading_session_list` → `session_list_visible`, server-sorted DESC (`US-203.md:174-193`). Blocked at RC-2; never reaches `session_list_loaded`. |
| `test_us203…::test_recent_sessions_nav_caps_at_five_rows` (`:190`) | **GENUINE-UNIMPLEMENTED** | US-203 AC: recent-sessions rail = first 5 (`US-203.md`). RC-2. |
| `test_us203…::test_zero_sessions_project_enters_no_sessions_empty_state_sub_shape` (`:210`) | **GENUINE-UNIMPLEMENTED** | US-203 AC: empty `items` → `no_sessions_empty_state` sub-shape (`US-203.md`). RC-2. |
| `test_us203…::test_session_list_is_paginated_for_projects_with_more_than_thirty_sessions` (`:234`) | **GENUINE-UNIMPLEMENTED** | US-203 AC: Chats page = first 30 + pagination (`US-203.md`). RC-2. |
| `test_us203…::test_session_created_in_other_tab_refreshes_list_within_one_second` (`:266/334`) | **GENUINE-UNIMPLEMENTED** | US-203 AC: cross-tab refresh ≤1s via projection stream (`US-203.md`); roadmap MR-2 adds the SSE route (`handoff-distill-to-deliver.md:148`). RC-2 (precondition) + SSE path. |
| `test_us205…::test_resuming_session_restores_transcript_and_dataset_chip_on_same_first_paint` (`:179`) | **GENUINE-UNIMPLEMENTED** | US-205 AC: atomic transcript + `active_scope.resource_*` materialization (`US-205.md:184-208`). RC-2 precondition. (Storage shape OQ-J002-1 was a *blocking* DESIGN OQ that DESIGN closed — Option A, migration 009 — so this is delivery debt, not deferral.) |
| `test_us205…::test_resuming_session_with_null_dataset_enters_conversational_mode` (`:215`) | **GENUINE-UNIMPLEMENTED** | US-205 AC: null `active_dataset_id` → `resource_*` null + FlowEvent (`US-205.md`). RC-2. |
| `test_us205…::test_resuming_session_with_deleted_dataset_degrades_gracefully_to_conversational` (`:246`) | **GENUINE-UNIMPLEMENTED** | US-205 AC: unresolvable dataset → graceful degrade (`US-205.md`). RC-2. |
| `test_us205…::test_resuming_nonexistent_session_returns_silently_to_session_list_loaded` (`:280`) | **GENUINE-UNIMPLEMENTED** | US-205 AC: unknown `session_id` → silent return to list, no error panel (`US-205.md:201`). RC-2. |
| `test_journey_invariants_j002.py::test_ic_j002_3_resuming_session_to_session_active_materializes_atomically` (`:355`) | **GENUINE-UNIMPLEMENTED** | IC-J002-3 scheduled MR-2 (`test_journey_invariants_j002.py:20`). RC-2 precondition. |

ENVIRONMENTAL in `mr_2` (2): `test_us203…::test_ts_harness_asserts_session_list_ordering`,
`test_us205…::test_ts_harness_asserts_resume_contract` — see §4.4.

### 4.3 `mr_3` — Slice 3 (US-206 new-session lifecycle)

Roadmap MR-3: "6 total: US-206's 6", exit "no ghost rows … composer
text preserved" (`distill/handoff-distill-to-deliver.md:161-170`). All
6 fail in isolation (5 functional + 1 ENVIRONMENTAL). Every functional
test funnels through `_spawn_j002_and_wait_session_list`
(`test_us206…:95-112`) — **RC-2**, identical precondition gate as
mr_2.

| Test | Bucket | Rationale |
|---|---|---|
| `test_us206…::test_clicking_new_session_lands_in_welcome_state_with_no_backend_write` (`:176`) | **GENUINE-UNIMPLEMENTED** | US-206 AC: `new_session_clicked` → `session_active_no_messages`, no backend write, `session_id` null (`US-206.md:201-225`). RC-2 precondition. |
| `test_us206…::test_sending_first_message_eagerly_creates_session_with_title_from_message` (`:203`) | **GENUINE-UNIMPLEMENTED** | US-206 AC: `first_message_sent` → `create_session` → `session_active`, title = first message (`US-206.md`). RC-2. |
| `test_us206…::test_navigating_away_from_welcome_state_leaves_no_ghost_session_row` (`:253`) | **GENUINE-UNIMPLEMENTED** | US-206 AC: navigate-away without first message → no session row (`US-206.md`). RC-2. |
| `test_us206…::test_clicking_existing_session_from_welcome_state_cancels_new_session_intent` (`:306`) | **GENUINE-UNIMPLEMENTED** | US-206 AC: existing-session click cancels new-session intent → `resuming_session` (`US-206.md`). RC-2. |
| `test_us206…::test_transient_create_session_failure_preserves_composer_text_across_retry` (`:337`) | **GENUINE-UNIMPLEMENTED** | US-206 AC: transient `create_session` failure → `error_recoverable`, composer preserved (`US-206.md`). RC-2 precondition. |

ENVIRONMENTAL in `mr_3` (1): `test_us206…::test_ts_harness_drives_new_session_lifecycle_end_to_end` — see §4.4.

### 4.4 ENVIRONMENTAL — the 6 `test_ts_harness_*` scenarios

`test_us201…::test_ts_harness_drives_no_projects_path_end_to_end`,
`test_us202…::test_ts_harness_asserts_initial_project_resolution`,
`test_us203…::test_ts_harness_asserts_session_list_ordering`,
`test_us204…::test_ts_harness_drives_deep_link_resolution_for_both_happy_and_cross_tenant`,
`test_us205…::test_ts_harness_asserts_resume_contract`,
`test_us206…::test_ts_harness_drives_new_session_lifecycle_end_to_end`.

All fail identically:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'tsx'
  imported from …/tests/acceptance/user-flow-state-machines/
```

**This is tooling, not product.** Both prerequisites for product
behavior are present:

- The `harness.j002.*` namespace **is fully implemented** —
  `tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts:333-1106`
  (begin, open_deep_link, get_projection, assert_initial_project,
  assert_scope, resume_session, get_session_list, start_new_session,
  send_first_message, assert_scope_mismatch, …).
- `tsx` **is a declared devDependency** —
  `tests/acceptance/user-flow-state-machines/package.json:25`
  (`"tsx": "^4.19.0"`).

The failure is purely that
`tests/acceptance/user-flow-state-machines/node_modules` is not
installed (no `node_modules/.bin/tsx`), compounded by the test passing
`env={"PATH": …}` to the `node --import tsx` subprocess
(`test_us201…:~388`), stripping everything but `PATH`. The
`requires_ts_harness` skip-guard (`conftest.py:94-123`) only checks
that the harness *file* exists and contains `"j002"` — it does **not**
guard on `node_modules` being installed, so these run instead of
skipping. Fix is `npm ci` in that package (or a stronger skip-guard) —
**no J-002 product change involved**.

---

## 5. Cross-cutting wave-decision conflict (must reconcile before remediation)

US-201's AC and IC-J002-2 require J-002 to **own** the create-project
sub-flow (`create_project_submitted` → `creating_project` →
`project_selected`; empty-name validation state; transient-failure
recoverable state — `US-201.md:166-188`,
`test_journey_invariants_j002.py:204-248`). Wave-decision **D6**
explicitly states the opposite: project create/delete/rename are
single-step CRUD, "J-002 *observes* their completion via the
projection … but J-002 does **NOT** carry validation, naming, or
deletion-confirmation state internally"
(`discuss/wave-decisions.md:156-166`).

This DISCUSS-internal contradiction was never reconciled into DESIGN.
It is the reason the create-project triage splits: the **observe →
`project_selected`** end-state (US-201 happy path, IC-J002-2) is
GENUINE-UNIMPLEMENTED (in scope under D6's "observes completion"); the
**J-002-internal validation / recoverable-error state**
(`test_empty_project_name`, `test_transient_create_project_failure`)
is DEFERRED-BY-DESIGN under D6's explicit carve-out. **Recommendation**:
the overseer (or a `/nw-discuss` reconciliation pass) must pick a
side — either amend D6, or amend US-201 AC + remove/skip the two
internal-state assertions — before TDD remediation, else the Iron Rule
will be violated by whichever spec is wrong.

A parallel unreconciled delta exists for
`most_recent_session_per_project` (OQ-J002-5): DISCUSS marked it
non-blocking / "tracked for DESIGN" (`dor-validation.md:58,269`);
`design/application-architecture.md:1078` later specs the field as
populated on `resolving_initial_scope` exit. The triage records the
failing assertion as DEFERRED-BY-DESIGN with this dissent surfaced.

---

## 6. Quantification & ordered remediation

### 6.1 Counts

| Bucket | Count | Tests |
|---|---:|---|
| GENUINE-UNIMPLEMENTED | **23** | mr_1: 8 (us201 first_sign_in, us201 creating_first_project, us202 transient_list_sessions_degraded, us204×4, IC-J002-2) · mr_2: 10 (us203×5, us205×4, IC-J002-3) · mr_3: 5 (us206×5) |
| DEFERRED-BY-DESIGN | **3** | us201 empty_project_name, us201 transient_create_project_failure (D6 carve-out); us202 resolution_picks_most_recent (OQ-J002-5 map) |
| ENVIRONMENTAL | **6** | the 6 `test_ts_harness_*` (tsx not installed) |
| TEST-OVER-SPEC | **0** | secondary dissent recorded on the 3 DEFERRED |
| **Total stable failures** | **32** | (mr_1 14 · mr_2 12 · mr_3 6) |

### 6.2 Ordered recommendation

1. **FIRST — reconcile §5 wave-decision conflicts** (zero code).
   `/nw-discuss` mini-pass or overseer ruling on (a) D6 vs US-201
   create-flow ownership, (b) OQ-J002-5 read-shape closure. Blocks
   correct RED interpretation for 3 DEFERRED + the 2 create-path
   GENUINE tests. Effort: S (hours).

2. **ENVIRONMENTAL — unblock the 6 harness tests** (zero product
   code). `npm ci` in `tests/acceptance/user-flow-state-machines/`
   and/or strengthen `requires_ts_harness` (`conftest.py:94-123`) to
   also skip when `node_modules` is absent. Effort: S. Converts 6
   false-RED to either GREEN or cleanly-skipped — clears noise before
   TDD.

3. **RC-2 — mr_2 + mr_3 session-chat cluster (15 GENUINE tests, one
   root cause)**. Highest leverage: fixing identity propagation
   project-context → orchestrator → session-chat so `loadSessionList`
   succeeds and `session_list_loaded` is reachable unblocks all of
   US-203 (5), US-205 (4), US-206 (5), IC-J002-3 (1) at once. Suggested
   wave: **`/nw-bugfix`** (cause now known: identity not in
   session-chat context — `ui-state/lib/orchestrator.ts` broadcast +
   `session-chat/machine.ts` loadSessionList) → DISTILL regression
   already exists (these tests *are* the spec) → DELIVER. Effort: M–L
   (one substrate defect, broad blast radius).

4. **RC-1 — mr_1 deep-link + projection emission (5 GENUINE tests)**.
   Post-settle `open-deep-link` re-resolution with intent
   (`ui-state/index.ts` deep-link handler + `project-context/machine.ts`
   resolver re-entry) fixes us204×3 (cross_tenant, project_not_found,
   intent_resource) and the cold SSR deep-link; emitting
   `last_used_resolution_degraded` into the projection
   (`ui-state/lib/projection.ts`) fixes us202 degraded. Suggested
   wave: **`/nw-deliver`** against the existing acceptance tests.
   Effort: M.

5. **mr_1 create-path + first-name loader (2 GENUINE, post-§5)**.
   After §5 ruling: wire `create_project_submitted` → `project_selected`
   (us201 creating_first_project, IC-J002-2) and surface
   `user.first_name` into the FE root/SSR loader (us201 first_sign_in
   — the walking-skeleton gate). Suggested wave: **`/nw-deliver`**.
   Effort: M.

6. **DEFERRED-BY-DESIGN disposition (3, post-§5)**. Per the §5
   ruling, either implement (if D6/OQ-J002-5 amended in favor of the
   AC) or skip-mark with the wave-decision citation (if upheld). The
   overseer decides per-test; this RCA does **not** apply any
   disposition (Iron Rule / read-only).

---

## 7. Caveats

- Read-only RCA: no test/code/stack mutation; classifications are
  recommendations, not applied dispositions.
- Bucket assignment uses "exactly one bucket" per the brief; genuine
  cross-bucket ambiguity (the §5 conflicts) is surfaced as explicit
  dissent rather than hidden by the single-label requirement.
- `mr_4`/`mr_5`/`mr_6` GREEN was taken as given (overseer-proven); the
  fact that MR-4/5/6 depend on a working `session-chat` while
  MR-2/MR-3 RC-2 shows it failing for the Python entry suggests
  MR-4/5/6 exercise session-chat via a different (harness/identity-
  bearing) entry path — noted for the remediation engineer; not
  re-derived here.
