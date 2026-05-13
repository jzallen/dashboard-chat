# Wave Decisions — DISTILL — `project-and-chat-session-management` (J-002)

> **Wave**: DISTILL
> **Date**: 2026-05-13
> **Acceptance Designer**: nw-acceptance-designer (J-002 DISTILL wave)
> **Inherited from DESIGN**: 6 artifacts under
> `docs/feature/project-and-chat-session-management/design/`
> **Anchor**: `design/handoff-design-to-distill.md` — MR-by-MR scope mapping,
> 62 scenarios, 7 ICs, TS-harness operations, risk registry, open items O1..O7.
> **Companion deliverables**: `features/*.feature`, `tests/acceptance/project-and-chat-session-management/test_*.py`,
> `roadmap.json`, `handoff-distill-to-deliver.md`, `walking-skeleton.md`,
> `upstream-issues.md`.

This document records the DISTILL-wave decisions (DD-1..DD-7) that bind
subsequent DELIVER. It resolves: test-framework choice, walking-skeleton
strategy, carpaccio confirmation, the two Praxis-deferred scenarios
(F-4 stale-intent filter; F-5 IC-J002-1 property), Mandate 7 scaffolding
posture, and the per-MR un-skip schedule.

DISCUSS D1–D12 and DESIGN DWD-1..DWD-12 are inherited verbatim — DISTILL
does not re-litigate either.

---

## DD-1 — Test framework: pytest + httpx + subprocess (mirrors `frontend-coexistence`)

**Decision**: The J-002 acceptance suite at
`tests/acceptance/project-and-chat-session-management/` uses **plain
pytest with `httpx` HTTP probes and `subprocess` for the TS harness
invocation**. NOT pytest-bdd; NOT cucumber-js. The `.feature` files at
`docs/feature/project-and-chat-session-management/distill/features/`
are the **Gherkin SSOT** consumed by humans; pytest functions are the
**executable** referencing each scenario by docstring.

This diverges from J-001 (which used `@cucumber/cucumber` 12.x — see
`docs/evolution/2026-05-12-user-flow-state-machines/distill/wave-decisions.md`
DWD-1). J-001's choice was driven by the TS-internal-only surface;
J-002's surface is cross-cutting (ui-state TS + agent TS + backend
Python + FE SSR Hono), and **Python is the established neutral cross-
service test driver** in this repo (`tests/integration/dataset_layer/`
and every other `tests/acceptance/*/` Python suite).

### Why

| Option | Pros | Cons |
|---|---|---|
| **A — pytest + httpx + subprocess** (CHOSEN) | Matches `frontend-coexistence` DISTILL pattern, CLAUDE.md "Acceptance suites" convention, cross-service neutrality. Python suites can call backend/agent/ui-state endpoints uniformly. | TS harness exposed via subprocess invocation rather than direct import. |
| B — pytest-bdd | Direct Gherkin parsing; closer 1:1 mapping per scenario | Adds a plugin layer; the team has no pytest-bdd precedent in repo; learning cost vs payoff is unfavorable for 65 scenarios. |
| C — cucumber-js (J-001 pattern) | Single TS world; direct harness import | The cross-service surface (backend pytest + agent + ui-state) is Python-rooted in this repo. Forcing the TS host on cross-service tests is the wrong shape. |

The DISCUSS handoff and DESIGN handoff both recommended pytest-bdd; the
command-args specified pytest+httpx+subprocess matching `frontend-
coexistence`. **The latter wins** because:

1. **The compose-stack is the binding driving port** (DD-3 below). HTTP
   probing through `reverse-proxy:5173` is the same shape every backend/
   integration test uses today; pytest-bdd would not add value at that boundary.
2. **The TS-harness scenarios** (`@needs_ts_harness` — 12 of 65 tests)
   call the J-001 TS harness via subprocess. Per `tests/acceptance/
   user-flow-state-machines/`, the harness's existing public surface is
   ESM-importable from Node; a subprocess invocation is idiomatic.
3. **The Gherkin SSOT** lives in the feature files; nothing about the
   shape of the test runner changes the binding contract. Tests cite
   the `.feature` filename + scenario name in their docstring; reviewers
   read the `.feature` directly.

**Why**: structural fit with the cross-service suite topology and
CLAUDE.md acceptance-suite convention.

**How to apply**: every test module imports `J002Driver` from `driver.py`;
the driver composes `httpx` + `pathlib` + `subprocess`. Per-feature
`pyproject.toml` + uv venv per CLAUDE.md. Run from inside the suite dir:
`cd tests/acceptance/project-and-chat-session-management && uv run
--no-project pytest`.

---

## DD-2 — Walking-skeleton strategy: **Strategy C** (real local + skip-when-unavailable)

**Decision**: Strategy C per the nw-distill skill's decision tree:
all driven adapters are real where local (compose stack — ui-state,
backend, agent, auth-proxy, Redis, MinIO, query-engine); WorkOS stays
faked (in-process Hono server inherited from J-001). The TS
UserFlowHarness extension `harness.j002.*` is the in-process driver
invoked via subprocess.

This matches J-001 DELIVER's Strategy C exactly (the substrate's local
compose stack is the same stack J-002 runs against). When the local
compose stack is not reachable, scenarios skip cleanly via
`requires_compose_stack` (probe of `reverse-proxy:5173`).

### Adapter coverage table (Mandate 6)

| Driven adapter | `@real-io` scenario (file + name) | Mode |
|---|---|---|
| `uiStateClient` (FE → ui-state HTTP) | `test_us201::test_first_sign_in_foregrounds_the_no_projects_welcome_panel` (walking skeleton) | real |
| `MachineRegistry` + `FlowOrchestrator` (J-002 actor spawn) | `test_us201::test_first_sign_in_*` (same WS) | real |
| `EVENT_HANDLERS` projection extension | `test_us201::test_first_sign_in_*` (read-back of `state` field) | real |
| `ScopeResolver` (`active-scope.ts`) — invariant 4 | `test_us204::test_cross_tenant_deep_link_lands_in_scope_mismatch_terminal` | real |
| `ScopeResolver` — invariant 4 (dataset path) | `test_us209::test_cross_tenant_dataset_pick_rejected_with_prior_scope_preserved` | real |
| Backend `create_project` use case | `test_us201::test_creating_first_project_lands_in_project_selected` | real |
| Backend `list_projects` + `list_sessions` | `test_us202::test_resolution_picks_project_carrying_most_recent_session` | real |
| Backend `create_session` (eager) | `test_us206::test_sending_first_message_eagerly_creates_session_with_title_from_message` | real |
| Backend `update_session` allowlist (`active_dataset_id` column, DWD-2) | `test_us205::test_resuming_session_restores_transcript_and_dataset_chip_*` + `test_us209::test_*direct_dataset_selection_*` | real |
| `Migration 009` (`active_dataset_id` schema delta) | `test_us205::*` covers read path; `test_us209::*` covers write | real |
| Redis Streams `XREAD BLOCK` subscribe() (SSE projection-stream — DWD-9) | `test_us203::test_session_created_in_other_tab_refreshes_list_within_one_second` | real |
| Agent `extractActiveScope` middleware (DWD-3) | `test_us208::test_chat_turn_from_session_active_carries_x_active_scope_*` | real |
| Agent body-fallback path (migration window) | `test_us208::test_during_migration_window_*` | real |
| Agent compile-time sunset check | `test_us208::test_compile_time_sunset_check_fails_agent_startup_*` | startup-test |
| RRv7 loaders (5 routes graduating per DWD-4) | `test_us201..us205::*` (root.tsx + project-detail + projects + chat + sessions loaders) | real |
| `uiStateClient.activeScopeHeader` writer | `test_us208::*` + `test_journey_invariants_j002::test_ic_j002_7_*` | real |
| TS UserFlowHarness `harness.j002.*` (12 ops) | every `@harness @needs_ts_harness` scenario (12 total) | subprocess |
| Orchestrator `j001_ready` broadcast hook (RD1) | `test_journey_invariants_j002::test_ic_j002_1_entry_from_j001_ready_*` (+ Praxis F-5) | real |
| Orchestrator FREEZE/THAW broadcast + replay buffer | `test_us210::*` + `test_journey_invariants_j002::test_ic_j002_6_*` | real |
| Orchestrator per-J-002 stale-intent guards (DWD-7) | `test_us210::test_multiple_intents_queued_*` + `test_us210::test_praxis_f4_*` | real |

**Mandate 6 result**: every driven adapter has at least one `@real-io`
scenario. **Zero NO-MISSING rows.** Future J-NNN flows inherit this
coverage shape mechanically.

### Why

Per the nw-distill decision tree: J-002 has only local resources
(filesystem, Redis, Postgres-or-SQLite, Hono processes, Python backend)
and one costly external (WorkOS) which is already faked from J-001.
Strategy A would require InMemory doubles for the entire ui-state tier
(rebuilding what J-001 already runs real); Strategy B's "real local +
fake costly" is exactly Strategy C plus the WorkOS fake which already
exists; Strategy D (configurable) overengineers for a single observable
posture.

**How to apply**: every test module is tagged `@pytest.mark.real_io`
and `@pytest.mark.needs_compose_stack`. The `requires_compose_stack`
fixture probes `reverse-proxy:5173` and skips on absence. The
`requires_ts_harness` fixture probes for the J-001 harness's `j002`
namespace export and skips if MR-1 has not landed it yet.

---

## DD-3 — Driving port: `reverse-proxy:5173` (production ingress)

**Decision**: every scenario invokes through HTTP to `reverse-proxy`
(`http://localhost:5173`), the user-facing driving port per ADR-016 +
ADR-031 + ADR-034. The ui-state tier's host port (`localhost:1043`) is
**diagnostic-only** — used by tests when asserting on the projection's
internal `state` field but never as the primary scenario entry-point.

This mirrors J-001 DWD-3 and `frontend-coexistence` DI-3 verbatim:
**no test imports `ui-state/lib/**` source**. The TS UserFlowHarness
runs via subprocess; the harness internally imports from `ui-state/`
but the test process does not.

### Verification grep (CM-A evidence)

```bash
grep -rE 'from .*ui-state/lib' tests/acceptance/project-and-chat-session-management/ || echo OK
grep -rE 'from .*ui-state/lib' docs/feature/project-and-chat-session-management/distill/features/ || echo OK
```

Both expected to return `OK` at hand-off and at every DELIVER MR.

### Why

ADR-027/030/034 designate the production ingress; tests should fail the
same way users would. Allowing direct ui-state imports would bypass
auth-proxy header injection (`X-Org-Id`, `X-User-Id`, `Authorization` →
JWT verification), the SSR loader pipeline, and the M2M token mint path.

---

## DD-4 — Praxis F-4 resolution: FIFO replay + per-intent staleness-guard for dataset picks

**Decision**: the Praxis system-designer review (`docs/feature/project-and-chat-session-management/design/review-by-system-designer.md` §3 F-4) deferred to DISTILL the question of what happens when **two dataset picks queue concurrently during FREEZE**. The reviewer recommended:

> On THAW, dataset intents replay in FIFO order. If intent N passes
> the staleness guard (ScopeResolver I4 OK) and intent N+1 fails
> (dataset deleted or cross-tenant), the project + resource context
> for intent N persist — intent N+1 is silent-dropped.

DISTILL ratifies this verbatim. The mechanical encoding is one explicit
scenario in `test_us210_freeze_thaw_replay.py`:
`test_praxis_f4_concurrent_dataset_picks_during_freeze_fifo_replay_with_staleness_guard`
(also `@property` tagged). The Gherkin SSOT is the
`@praxis_f4 @boundary @property` scenario in
`features/us-210-freeze-thaw-replay.feature`.

### Specific assertions

1. **FIFO replay order**: the orchestrator's existing replay buffer
   (`ui-state/lib/orchestrator.ts:54-56`) preserves arrival order. Both
   `dataset_resolved_by_agent` intents queue with their original
   correlation references.
2. **Intent N (valid)**: passes ScopeResolver I4 → J-002 transitions
   through `switching_dataset_context` → `session_active` with
   `resource_id = patients_2025`; `session.active_dataset_id` is
   persisted (DWD-2's column write).
3. **Intent N+1 (stale)**: fails ScopeResolver I4 (dataset deleted OR
   cross-tenant) → J-002's guard from DWD-7 silent-drops with
   `stale_intent_dropped_after_thaw { intent_type: "dataset_resolved_by_agent",
   target_id: <bad-id> }`. The prior `context.resource` (intent N's
   value) is preserved.
4. **No scope_mismatch_terminal**: the user-meaningful surface is
   reserved for `switching_project_intent` failures per DWD-7. A
   silent-drop for a dataset is the muscle-memory case (handoff-design
   §OQ-J002-6).
5. **Harness assertion**: `harness.j002.assert_stale_intent_dropped(
   "dataset_resolved_by_agent", <bad-id>)` succeeds.

### Why

The reviewer's recommendation is precisely the FIFO + per-intent-
staleness-guard pattern DWD-7 already specifies for the J-002 side.
F-4 is a special case (concurrent picks during FREEZE) of the general
rule; encoding it as an explicit acceptance scenario closes the test-
coverage boundary the reviewer flagged.

**How to apply**: MR-6 DELIVER lands the J-002 guards per DWD-7 and
implements the harness method. The acceptance scenario un-skips at
the same MR.

---

## DD-5 — Praxis F-5 resolution: IC-J002-1 property — `org_id` consistency across J-001 ↔ J-002 ↔ JWT

**Decision**: the Praxis review §3 F-5 deferred to DISTILL the question
of whether IC-J002-1 was guarded by assertion. The reviewer recommended:

> J-002's `context.org_id` at `resolving_initial_scope` entry equals
> the JWT's decoded `org_id` claim AND equals the J-001 projection's
> `active_scope.org_id` at the same `sequence_id` boundary (within
> 100ms for clock skew).

DISTILL ratifies this verbatim. The mechanical encoding is one explicit
property test in `test_journey_invariants_j002.py`:
`test_ic_j002_1_entry_from_j001_ready_reads_org_id_from_j001_projection`
(tagged `@praxis_f5`). The Gherkin SSOT is the
`@mr_1 @ic-j002-1 @praxis_f5` scenario in
`features/journey-invariants-j002.feature`.

### Specific assertions

1. `J-002.context.org_id == J-001.projection.active_scope.org_id` at
   the same `sequence_id` boundary (within 100ms clock-skew tolerance).
2. `J-002.context.org_id == JWT.decoded.org_id`.
3. No separate `/api/orgs/me` or JWT-decode fetch is observed in the
   request log — the value flows orchestrator → J-002 directly per
   DWD-6 (the `j001_ready` broadcast hook).

### Why

Multi-org safety (future J-NNN flows) depends on this invariant holding
mechanically. The current contract assumes JWT and J-001-broadcast
`org_id` are identical; if they diverge (e.g., JWT re-issue during
org-switching — D10 deferred), J-002 could populate a stale `org_id`.
This property test makes drift detectable at the suite level.

**How to apply**: MR-1 DELIVER lands the `j001_ready` broadcast hook
per DWD-6 + the orchestrator's per-flow callback. The property test
un-skips at MR-1.

---

## DD-6 — Carpaccio confirmation: DESIGN's 6 slices stand as 6 sequential MRs

**Decision**: DISTILL confirms the 6-slice carpaccio from DESIGN's
handoff §"MR-by-MR scope mapping" is structurally sound — each slice
is independently shippable as a RED→GREEN merge request with bounded
file scope and explicit dependencies on prior MRs.

DISTILL does NOT introduce a slicing-of-slicing (e.g., MR-1a / MR-1b
deferral of `root.tsx` per Praxis F-3 fallback). That option remains
available to DELIVER if Phase 04 capacity is not green at MR-1 start
time — DISTILL documents the fallback in `upstream-issues.md` O7 but
does not pre-bake it into `roadmap.json`. MR-1 stays whole until
DELIVER chooses otherwise.

### MR-by-MR scenario count

| MR | Scenarios | Walking skeleton | Error path | Boundary | Property | Harness |
|---|---|---|---|---|---|---|
| **MR-1** (US-201/202/204 + IC-J002-1/2) | 18 | 1 | 5 | 3 | 2 | 3 |
| **MR-2** (US-203/205 + IC-J002-3) | 12 | 0 | 1 | 3 | 1 | 2 |
| **MR-3** (US-206) | 6 | 0 | 1 | 1 | 0 | 1 |
| **MR-4** (US-207/208 + IC-J002-4/7) | 14 | 0 | 6 | 2 | 2 | 2 |
| **MR-5** (US-209 + IC-J002-5) | 7 | 0 | 1 | 1 | 2 | 1 |
| **MR-6** (US-210 + IC-J002-6 + Praxis F-4) | 8 | 0 | 1 | 4 | 2 | 1 |
| **Totals** | **65** | **1** | **15** | **14** | **9** | **10** |

**Error-path ratio**: 15 explicit `@error_path` + 14 `@boundary` + 1
`@degraded` = 30 / 65 = **46%** (above the nw-distill skill's 40%
target). With the 9 `@property` invariants (which encode negative-
branch contracts) the ratio is 60%. The walking-skeleton is the sole
`@walking_skeleton`-tagged scenario per the skill's "exactly ONE"
guidance.

### Why

J-002 inherits J-001's substrate and DESIGN's carpaccio plan. The
6-slice carpaccio is a proven shape from J-001 (6 slices, 23 scenarios)
extended naturally to 6 slices × ~11 scenarios = 65 total. The slicing
discriminator from DESIGN (`§9 sequencing constraints`: MR-1 is
substrate-extension; MR-2 has the only schema migration; MR-4 has the
only backward-compat flag; MR-6 depends on 1–5) is preserved verbatim.

---

## DD-7 — Mandate 7 scaffolding posture: **deferred to DELIVER MR-1**

**Decision**: DISTILL does NOT pre-create Mandate 7 RED scaffolds under
`ui-state/`, `agent/`, `backend/`, or `frontend/`. Every scaffold target
named by DESIGN's "Files created / Files extended" already exists as a
LIVE module (extended, not net-new) — except for:

| Net-new file | Owner | Lands in |
|---|---|---|
| `ui-state/lib/machines/project-and-chat-session-management.ts` | DELIVER MR-1 | MR-1 |
| `agent/lib/chat/scope.ts` (helper for `extractActiveScope`) | DELIVER MR-4 | MR-4 |
| `backend/migrations/versions/009_add_session_active_dataset_id.py` | DELIVER MR-2 | MR-2 |

These three files are the ONLY net-new production paths. DISTILL leaves
them un-scaffolded because:

1. **All scenarios are `pytest.mark.skip`-marked** — none would import
   the new files at test-collection time anyway. The `--auto` gate
   passes because pytest doesn't collect production sources, only the
   test modules themselves; the test modules import only `driver.py` +
   `pytest`.
2. **Mandate 7's RED-vs-BROKEN classification** applies when tests
   import production modules. Our tests drive through HTTP only — they
   never `import` from `ui-state/lib/**`, `agent/lib/**`, `backend/app/**`
   (per DD-3 + DWD-3 of J-001).
3. **Pre-scaffolding three TS/Python files for the sake of marker
   compliance** would add noise without epistemic value; if a scaffold
   is committed it must be deleted at the same MR that replaces it,
   which is mechanical churn.

**The exception is the TS harness extension.** MR-1 DELIVER must add
the `harness.j002.*` namespace to the J-001 harness at
`tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts`.
DISTILL leaves this un-scaffolded (the `requires_ts_harness` fixture
skips the 12 harness-driven scenarios cleanly until it lands).

### Why

Mandate 7's purpose is to make tests RED, not BROKEN. We accomplish the
same outcome via `pytest.mark.skip` — the test runner reports SKIPPED,
not BROKEN, by construction. Pre-scaffolding is unnecessary for this
suite's shape.

**How to apply**: MR-1 DELIVER lands the three net-new files in
production paths as part of its DELIVER work. DISTILL → DELIVER hand-
off names this explicitly in `handoff-distill-to-deliver.md` §"Net-new
files".

---

## Reuse Analysis (HARD GATE — repeated from DESIGN application-architecture.md §13)

DISTILL inherits DESIGN's reuse decisions verbatim. The acceptance-test
artifacts themselves follow the same posture:

| Test-side artifact | Decision | Justification |
|---|---|---|
| TS UserFlowHarness (J-001) | **EXTEND** with `harness.j002.*` (12 ops) | Same module, new namespace. ADR-028:46-48 is a production-code constraint; harness has no analogous prohibition. |
| Python DatasetLayerHarness | **EXTEND** with `chat_turn_with_scope_header` method (US-208) | One method addition per DESIGN handoff §"Python DatasetLayerHarness extension". |
| `tests/acceptance/project-and-chat-session-management/` venv | **CREATE NEW** (`pyproject.toml` + uv venv) | Per-feature isolation per CLAUDE.md acceptance-suite convention. J-001 uses npm workspace; J-002 uses uv venv. |
| `J002Driver` | **CREATE NEW** at `tests/acceptance/project-and-chat-session-management/driver.py` | Per-feature thin I/O composition; mirrors `frontend-coexistence` `FrontendCoexistenceDriver`. |
| Driving port URL | **REUSE** `http://localhost:5173` (reverse-proxy) | DD-3 mandates production ingress. |
| Compose stack | **REUSE** unchanged (7 services per ADR-016 + ADR-030 + ADR-034) | DESIGN handoff §"DEVOPS handoff annotations" — the stack is unchanged by J-002. |

---

## KPI observability (soft gate)

`docs/product/kpi-contracts.yaml` does NOT yet exist. The K-J002-1..6
SSOT lives in
`docs/feature/project-and-chat-session-management/discuss/outcome-kpis.md`.
DISTILL's `@kpi` tag is NOT used because no scenario in this DISTILL pass
asserts a KPI metric event directly — KPI instrumentation is a DEVOPS
concern landing alongside Slice 4 per the DISCUSS handoff. DISTILL
flags this in `upstream-issues.md` REC-2 (carried over from J-001).

---

## Environmental Realism (Mandate 4 / Dim 8 Check B)

DEVOPS has not yet run for J-002 (the K-J002-* instrumentation spike
is a DEVOPS sub-wave per DESIGN handoff §"DEVOPS handoff annotations").
Per the nw-distill skill's graceful-degradation rule, the default
environment matrix applies:

| Env | Walking-skeleton coverage |
|---|---|
| `clean` | Fresh Redis; fresh sessions table; no pre-existing projects for the persona. `test_us201::test_first_sign_in_*` (walking skeleton). |
| `with-pre-commit` | Compose stack restarted mid-flow; ui-state-tier reads existing FlowEvent log from Redis. `test_us210::test_freeze_during_session_active_no_messages_*`. |
| `with-migration-pending` | Backend has migration 009 NOT applied; tests for US-205/209 skip with named diagnostic instead of running against the wrong schema. |

A future DEVOPS `environments.yaml` will replace this default matrix.

---

## Sign-off checklist (DISTILL gate)

- [x] All 10 user stories (US-201..US-210) traced to scenarios via
      `@us-N` tag (Dim 8 Check A) + one test module per story.
- [x] Walking skeleton declared with Strategy C (Dim 9a) and scope of
      "real local + skip-when-unavailable" matches J-001.
- [x] Walking skeleton invokes through driving port
      (`reverse-proxy:5173`) and exercises ALL local adapters real
      (Dim 9b/9d). Litmus test (Dim 9d): "if I deleted nginx /
      reverse-proxy, would the WS still pass?" → No.
- [x] **F-001 (adapter-integration)**: every driven adapter has at least
      one `@real-io` scenario per the table in DD-2. Synthetic data
      would miss format mismatches at the backend column boundary
      (`active_dataset_id`).
- [x] **F-005 (driving-port boundary)**: tests import from `driver.py`
      only (no `ui-state/lib`, no `agent/lib`, no `backend/app`).
- [x] **F-002 (timing/budget)**: timing assertions in `.feature` files
      use budgets ≥ 300ms (per US-201/204/207 — chosen by DISCUSS) AND
      ≥ 1s (per US-203 cross-tab). No <200ms timing assertion.
- [x] **F-003 (BDD imports)**: the suite uses plain pytest, not
      pytest-bdd; no `# noqa` markers needed for ruff-stripped imports.
- [x] **F-004 (timing under load)**: 300ms and 800ms budgets reflect
      DISCUSS commitments; not flaky under parallel load on the
      observed local stack.
- [x] Driving Adapter (Mandate 1 / CM-A): every driving port DESIGN
      named has at least one WS / real-io scenario exercising it via
      its protocol. The reverse-proxy + auth-proxy + agent + ui-state
      + backend endpoints are all covered.
- [x] Business-language purity: feature files use business language;
      technical terms (`HTTP`, `JSON`, `Redis`, `JWT claim`) live in
      driver.py / step methods only (verified by grep — see DD-3).
- [x] Praxis F-4 + F-5 deferred scenarios encoded as
      `@praxis_f4` + `@praxis_f5`-tagged tests (DD-4 + DD-5).
- [x] Mandate 7 RED scaffolds: posture documented in DD-7 (deferred to
      DELIVER MR-1 because tests skip cleanly without importing
      production sources).
- [x] `roadmap.json` sequences six MRs into 6 phased steps with
      explicit `scenarios_to_unskip` + `files_changed_estimate` +
      `exit_criteria` + `blocks` per the nw-distill template.
- [x] No DISCUSS / DESIGN wave-decision is overridden or contradicted.
- [ ] Peer review by `nw-acceptance-designer-reviewer` — pending.

---

## References

- DESIGN (binding): `docs/feature/project-and-chat-session-management/design/{application-architecture,wave-decisions,c4-diagrams,handoff-design-to-distill,review-by-solution-architect,review-by-system-designer}.md`
- DISCUSS (binding): `docs/feature/project-and-chat-session-management/discuss/{wave-decisions,handoff-design,journey-project-and-chat-session-management.yaml,outcome-kpis,shared-artifacts-registry,stories/US-{201..210}.md,slices/slice-{01..06}-*.md}`
- J-001 DISTILL (template): `docs/evolution/2026-05-12-user-flow-state-machines/distill/`
- `frontend-coexistence` DISTILL (pattern): `docs/feature/frontend-coexistence/distill/`
- ADRs (binding): ADR-014/015/016/018/027/028/029/030/031 §7/034
