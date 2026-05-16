# DISTILL → DELIVER Handoff — `project-and-chat-session-management` (J-002)

> **Wave**: DISTILL → DELIVER
> **Date**: 2026-05-13
> **From**: nw-acceptance-designer (J-002 DISTILL wave)
> **To**: nw-software-crafter (J-002 DELIVER wave — MR-1 first, sequential MR-2..MR-6)
> **Status**: All DISTILL artifacts shipped. Awaiting `nw-acceptance-designer-reviewer` PASS before this hand-off is binding.

---

## TL;DR for the DELIVER crafter

You inherit:

- **65 RED pytest scenarios** at `tests/acceptance/project-and-chat-session-management/test_*.py` (every test `@pytest.mark.skip`-marked with a per-MR un-skip reason).
- **11 Gherkin SSOT `.feature` files** at `docs/feature/project-and-chat-session-management/distill/features/` (one per US + one cross-cutting journey-invariants file).
- **`roadmap.json`** sequencing 6 MRs with explicit `scenarios_to_unskip`, `files_changed_estimate`, `exit_criteria`, and `blocks`.
- **`wave-decisions.md` DD-1..DD-7** ratifying test framework (pytest + httpx + subprocess), walking-skeleton strategy (Strategy C), Praxis F-4 + F-5 resolutions, and Mandate 7 scaffolding posture.
- **`walking-skeleton.md`** naming the single GREEN-gate scenario for MR-1 (`test_first_sign_in_foregrounds_the_no_projects_welcome_panel`).
- **`upstream-issues.md`** — zero HIGH blockers; O7 (loader fan-out coordination with Phase 04) is the only pre-MR-1 coordination concern.

You produce, per MR:

- Working code that goes from RED (the per-MR scenarios are `@pytest.mark.skip`) to GREEN (skips removed; tests pass).
- One MR per slice, sequential, via `gt mq submit` from the gastown rig workspace.

---

## What's solid (you can build directly on this)

- **The MR-by-MR scope mapping** in `roadmap.json` is the binding contract. Each step names its `scenarios_to_unskip`, `files_changed_estimate`, and `exit_criteria`. Treat them as the gate.
- **The TS UserFlowHarness extension** is named per-MR in `files_changed_estimate`. MR-1 lands `open_project`, `open_deep_link`, `create_first_project`, `assert_initial_project`, `assert_scope`, `assert_scope_mismatch`. Later MRs add more namespace methods. The harness lives at `tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts` (J-001's deliverable) — extend it; don't fork it.
- **Migration 009 sequencing** — MR-2's migration MUST land in dev + prod environments BEFORE its DELIVER MR enters the queue. Verify with `cd backend && uv run alembic current`.
- **The Praxis F-4 + F-5 scenarios** are encoded explicitly. F-5 lands at MR-1 (`test_ic_j002_1_*`); F-4 lands at MR-6 (`test_praxis_f4_*`). DELIVER doesn't choose where these go — DISTILL already placed them.

## What's open (DELIVER may surface)

| # | Item | Owner | Notes |
|---|---|---|---|
| O7 (from DESIGN) | Loader fan-out coordination with Phase 04 (slate crew, auth-proxy scaling) | DELIVER MR-1 engineer | Before opening MR-1, confirm with slate crew (or its successor task tracker) that Phase 04 auth-proxy capacity is final. Fallback: split MR-1 into 1a (machine + Redis-stream substrate) and 1b (root.tsx loader) — reduces Slice 1 to 4 loaders. See `upstream-issues.md` O7. |
| REC-2 | TS harness subprocess invocation pattern | DELIVER MR-1 engineer | Choose between `harness_runner.ts` (stdin-driven scenario spec) vs inline ESM script in `J002Driver.run_ts_harness`. Either works; see `upstream-issues.md` REC-2. |
| O6 (from DESIGN) | Literal `SCOPE_HEADER_FALLBACK_SUNSET` date | DELIVER MR-4 engineer | Set to ~6 weeks post-merge; document on team calendar. |

---

## MR-by-MR detail

### MR-1 — Slice 1 walking skeleton + substrate (US-201, US-202, US-204)

**Estimated size**: L (~3 days). **Blocks**: none.

**Net-new production files** (Mandate 7 posture per DD-7 — DISTILL did NOT pre-scaffold these):

- `ui-state/lib/machines/project-and-chat-session-management.ts` — the J-002 machine. Start with 5 states for this MR: `resolving_initial_scope`, `no_projects_empty_state`, `creating_project`, `project_selected`, `scope_mismatch_terminal` (+ `error_recoverable`). XState v5 `setup({...}).createMachine(...)` shape per DWD-1 + app-arch §2. The `freeze` side-state lands in MR-6.

**Net-new test infra** (DISTILL already shipped these):

- `tests/acceptance/project-and-chat-session-management/{pyproject.toml,conftest.py,driver.py,README.md}` — already present at this commit; nothing to change.

**Files extended**:

- `ui-state/lib/orchestrator.ts` — `MachineRegistry` strategy table replacing the hardcoded `if (input.machine !== "login-and-org-setup")` conditional (DWD-8); `j001_ready` broadcast hook fires when J-001's `priorState` map sees `creating_org → ready` (DWD-6 + RD1).
- `ui-state/lib/projection.ts` — extend `EVENT_HANDLERS` dispatch table with the 5 Slice-1 J-002 event types: `j002_resolution_started`, `project_selected`, `no_projects_displayed`, `project_created`, `scope_mismatch_displayed`, plus extend the existing `deep_link_opened` payload reducer to carry J-002 intent fields.
- `ui-state/index.ts` — 5 new HTTP route handlers under `/ui-state/flow/project-and-chat-session-management/{begin,event,projection,open-deep-link}` (the `/projection/stream` SSE route lands in MR-2 per DWD-9).
- `frontend/app/root.tsx` — root loader reading J-001 projection for `active_scope.org_id` per DWD-4 §6.1.
- `frontend/app/routes/project-detail.tsx` (NEW or EXTEND) — loader for `/projects/:projectId` AND `/projects/:projectId/datasets/:datasetId`.
- `frontend/app/routes/projects.tsx` (NEW or EXTEND) — loader for `/projects`.
- `frontend/app/lib/ui-state-client.ts` — extend with three methods: `getJ002Projection(flowId)`, `postJ002Event(flowId, event)`, `activeScopeHeader(projection)`.
- `tests/acceptance/user-flow-state-machines/harness/user-flow-harness.ts` — add the `j002` namespace exporting 6 ops for MR-1.

**Scenarios to un-skip** (18 total): see `roadmap.json` step 1 — US-201's 5, US-202's 5, US-204's 6, plus `test_ic_j002_1_*` (with Praxis F-5) and `test_ic_j002_2_*`.

**Exit criteria**:

1. The walking-skeleton scenario passes against the local compose stack.
2. All 18 MR-1 scenarios are GREEN.
3. `harness.j002.*` namespace is callable from node subprocess.
4. Praxis F-5 property test asserts org_id consistency across J-001 ↔ J-002 ↔ JWT.
5. Verification grep `grep -rE 'from .*ui-state/lib' tests/acceptance/project-and-chat-session-management/` returns no matches.

**Pre-MR-1 coordination**: confirm with slate crew that Phase 04 auth-proxy capacity is final (O7).

---

### MR-2 — Slice 2 session list + resume (US-203, US-205)

**Estimated size**: L (~3 days). **Blocks**: MR-1.

**Net-new production files**:

- `backend/migrations/versions/009_add_session_active_dataset_id.py` — adds nullable `active_dataset_id String(36)` column on `sessions` table per DWD-2. Forward-only in prod; `downgrade()` is dev escape hatch. Add a non-CASCADE index on the column. **Migration must apply BEFORE MR-2 lands.**

**Files extended**:

- `backend/app/use_cases/session/update_session.py` — allowlist `active_dataset_id` per DWD-2.
- `backend/app/repositories/metadata/session_record.py` — column declaration on the SQLAlchemy model.
- `ui-state/lib/machines/project-and-chat-session-management.ts` — +4 states: `loading_session_list`, `session_list_visible`, `resuming_session`, `session_active` (read-only path; write path lands MR-3 for first message).
- `ui-state/lib/projection.ts` — `EVENT_HANDLERS` for `session_list_load_started`, `session_list_loaded`, `session_list_displayed`, `session_resume_started`, `session_resumed`, `session_dataset_unavailable`, `last_used_resolution_degraded`.
- `ui-state/lib/persistence/redis.ts` — `subscribe(key, since): AsyncIterable<FlowEvent>` method using Redis Streams `XREAD BLOCK` per DWD-9 + RD2.
- `ui-state/index.ts` — NEW SSE route `GET /ui-state/flow/project-and-chat-session-management/projection/stream`.
- `frontend/app/routes/chat.tsx` — loader for `/` (index) AND `/chat/:channelId`.
- `frontend/app/routes/sessions.tsx` — loader for `/sessions`.
- TS harness extension: `resume_session`, `get_session_list`, `get_transcript`, `assert_session_active`, `assert_session_list_includes`.

**Scenarios to un-skip** (12 total): US-203's 6, US-205's 5, `test_ic_j002_3_*`.

**Exit criteria**:

1. Migration 009 applied to all environments.
2. All 12 MR-2 scenarios GREEN.
3. SSE cross-tab refresh works within 1s budget on the local stack.

---

### MR-3 — Slice 3 new-session lifecycle (US-206)

**Estimated size**: M (~2 days). **Blocks**: MR-2.

**Files extended**:

- `ui-state/lib/machines/project-and-chat-session-management.ts` — +1 state (`session_active_no_messages`); `createSessionEagerly` invoke on `first_message_sent`; `context.pending_first_message` for retry preservation.
- `ui-state/lib/projection.ts` — `EVENT_HANDLERS` for `session_welcome_displayed`.
- frontend chat-view component (composer-state preservation contract per app-arch §6.4).
- TS harness extension: `start_new_session`, `send_first_message`.

**Scenarios to un-skip** (6 total): US-206's 6.

**Exit criteria**: no ghost rows on navigate-away (assertion via backend session-count); composer text preserved across `error_recoverable → retry`.

---

### MR-4 — Slice 4 atomic project switching + agent contract (US-207, US-208) — K-J002-4 NORTH STAR

**Estimated size**: L (~3 days). **Blocks**: MR-1, MR-2, MR-3.

**Net-new production files**:

- `agent/lib/chat/scope.ts` — `extractActiveScope(c, body)` helper per DWD-3 + app-arch §4.1. Reads `X-Active-Scope` header; falls back to body's `project_id` during the migration window; validates `X-Active-Scope.org_id === X-Org-Id` (auth-proxy-injected); throws on missing fields.

**Files extended**:

- `ui-state/lib/machines/project-and-chat-session-management.ts` — +1 state (`switching_project`); `switchProject` invoke; entry-action invalidates `session_id` + `resource_*` per IC-J002-4.
- `ui-state/lib/projection.ts` — `EVENT_HANDLERS` for `switching_project_started`, `project_switched`.
- `frontend/app/lib/ui-state-client.ts` — `activeScopeHeader` called by ALL loader outbound fetches per DWD-3.
- frontend chat-view component — `eventSource.close()` on `projection.state === 'switching_project'`; `queryClient.invalidateQueries(['sessions', oldProjectId])` per DWD-11.
- `agent/lib/chat/handleChat.ts` — header-only scope read + body fallback + compile-time sunset assertion at module load.
- `agent/index.ts` — module-load assertion that fails fast if `SCOPE_HEADER_FALLBACK_SUNSET.getTime() >= Date.now()` AND `SCOPE_HEADER_FALLBACK_ENABLED === "true"`.
- Custom ESLint rule extension (per DWD-3 corollary) forbidding manual X-Active-Scope writes outside `uiStateClient.activeScopeHeader`.
- TS harness extension: `switch_project`, `assert_agent_received_scope`, `assert_agent_request_log_no_mismatched`.
- `backend/tests/integration/dataset_layer/harness.py` — `chat_turn_with_scope_header(scope, message)` per US-208 + DESIGN handoff §Python harness.

**Scenarios to un-skip** (14 total): US-207's 5, US-208's 7, `test_ic_j002_4_*`, `test_ic_j002_7_*`.

**Exit criteria**: K-J002-4 instrumentation lands BEFORE this MR ships (per DEVOPS handoff); compile-time sunset check verified fires on past-date + flag-true; IC-J002-4 + IC-J002-7 hold.

**Reminder (O6)**: set the literal `SCOPE_HEADER_FALLBACK_SUNSET` date in this MR (~6 weeks post-merge) AND add a calendar item for flag removal.

---

### MR-5 — Slice 5 dataset context switching (US-209)

**Estimated size**: M (~2 days). **Blocks**: MR-2, MR-4.

**Files extended**:

- `ui-state/lib/machines/project-and-chat-session-management.ts` — +1 state (`switching_dataset_context`); `switchDatasetContext` invoke per app-arch §2.3; +2 event handlers in `session_active`.
- `ui-state/lib/projection.ts` — `EVENT_HANDLERS` for `switching_dataset_context_started`, `dataset_attached`, `dataset_access_denied`.
- frontend chat-view component — one-line emit on `data-agent-request` typed-part handler → `postJ002Event({type: "dataset_resolved_by_agent", ...})`.

**Scenarios to un-skip** (7 total): US-209's 6, `test_ic_j002_5_*`.

**Exit criteria**: Migration 009's column write path exercised end-to-end; IC-J002-5 holds; cross-tenant pick preserves prior resource_* unchanged.

---

### MR-6 — Slice 6 cross-machine FREEZE/THAW + Praxis F-4 (US-210)

**Estimated size**: L (~3 days). **Blocks**: MR-1, MR-2, MR-3, MR-4, MR-5.

**Files extended**:

- `ui-state/lib/machines/project-and-chat-session-management.ts` — top-level `on.FREEZE` handler + `freeze` state + history-target THAW via `last_live_state` per DWD-6; per-intent stale-intent guards per DWD-7. Per-intent table in DWD-7 (`session_clicked`, `switching_project_intent`, `dataset_resolved_by_agent`, `dataset_picked_directly`, `new_session_clicked`, `first_message_sent`, `create_project_submitted`, `retry_clicked`, `back_to_projects_clicked`).
- `ui-state/lib/projection.ts` — `EVENT_HANDLERS` for `j002_frozen`, `j002_thawed`, `stale_intent_dropped_after_thaw`, `replay_abandoned`.
- TS harness extension: `freeze`, `thaw`, `assert_stale_intent_dropped`, `assert_no_stale_intents_dropped`.

**Scenarios to un-skip** (8 total): US-210's 7 (INCLUDING Praxis F-4), `test_ic_j002_6_*`.

**Exit criteria**: IC-J002-6 holds; Praxis F-4 asserts FIFO + per-intent staleness for dataset picks; 5s replay-buffer timeout transitions to `error_recoverable` with originating user-action preserved.

---

## TS UserFlowHarness `harness.j002.*` rollout

Per the journey YAML's `testing_surface.ts_harness.operations` block and DESIGN handoff §"TS UserFlowHarness extensions", the 21 J-002 ops land in 6 batches:

| MR | New ops |
|---|---|
| MR-1 | `open_project`, `open_deep_link`, `create_first_project`, `assert_initial_project`, `assert_scope`, `assert_scope_mismatch` |
| MR-2 | `resume_session`, `get_session_list`, `get_transcript`, `assert_session_active`, `assert_session_list_includes` |
| MR-3 | `start_new_session`, `send_first_message` |
| MR-4 | `switch_project`, `assert_agent_received_scope`, `assert_agent_request_log_no_mismatched` |
| MR-5 | `attach_dataset_via_agent`, `attach_dataset_directly` |
| MR-6 | `freeze`, `thaw`, `assert_stale_intent_dropped`, `assert_no_stale_intents_dropped` |

DELIVER may consolidate (e.g., add multiple ops in one MR if related) but the per-MR scenario un-skipping requires the named ops to exist.

---

## Local DELIVER workflow

Per CLAUDE.md acceptance-suite convention:

```bash
# Run the J-002 acceptance suite locally before submission
cd tests/acceptance/project-and-chat-session-management
uv run --no-project pytest

# Run only this MR's scenarios (e.g., MR-1)
uv run --no-project pytest -m mr_1

# Run a single scenario file
uv run --no-project pytest test_us201_first_time_lands_in_no_projects_empty_state.py

# Run with the walking-skeleton selector
uv run --no-project pytest -m walking_skeleton
```

The local compose stack is required for `@real_io` scenarios:

```bash
docker compose up -d              # from repo root
```

If the compose stack is not reachable, `@needs_compose_stack` tests skip with a named diagnostic.

---

## Merge-queue submission

Per CLAUDE.md "Workflow — trunk-based development":

```bash
# After MR-N is locally GREEN and committed:
cd /home/node/gt/dashboard_chat
gt mq submit --branch deliver/project-and-chat-session-management-mr-<N>
```

The refinery rebases on `main`, runs `--auto` (which falls through to `--backend` for code touches), and merges on green. The acceptance suite itself does NOT run in `--auto` — DELIVER runs it locally and gates submission on it.

**Do NOT use `gh pr create`.** Trunk-based via merge queue is the project's single entry point.

---

## Definition of Done (per MR)

For each MR (1..6) to be considered DONE:

1. All `scenarios_to_unskip` for that MR are GREEN.
2. All `exit_criteria` for that MR are met.
3. The MR's `files_changed_estimate` set is touched (additions or extensions); no production file outside this set is touched (carpaccio discipline).
4. `--auto` merge-queue gate passes (`--backend` falls through; passes because no backend test regresses).
5. The local acceptance suite reports zero `@pytest.mark.skip` for that MR's scenarios.
6. The next MR's `blocks` field clears for that MR.

After MR-6 is GREEN: J-002 is feature-complete. The user-flow archive at `docs/evolution/2026-05-13-project-and-chat-session-management/` is created via `/nw-finalize` per CLAUDE.md.

---

## References

- DISTILL (this wave): `docs/feature/project-and-chat-session-management/distill/{wave-decisions,roadmap.json,walking-skeleton,upstream-issues,handoff-distill-to-deliver}.md` + `features/*.feature`
- Acceptance suite: `tests/acceptance/project-and-chat-session-management/`
- DESIGN (binding): `docs/feature/project-and-chat-session-management/design/`
- DISCUSS (binding): `docs/feature/project-and-chat-session-management/discuss/`
- ADRs: ADR-014/015/016/018/027/028/029/030/031 §7/034
- J-001 archive (template): `docs/evolution/2026-05-12-user-flow-state-machines/`
- `frontend-coexistence` DISTILL (pattern, archived 2026-05-13): `docs/evolution/2026-05-13-frontend-coexistence/distill/`
