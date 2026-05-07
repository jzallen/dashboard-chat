# Refactor `DatasetLayerHarness` — Evolution

> **Feature**: refactor-dataset-layer-harness
> **Finalized**: 2026-05-07
> **Epic**: `dc-wcy` (5 phases — `dc-wcy.4` through `dc-wcy.8`)
> **Research input**: [`docs/research/2026-05-07-dataset-layer-harness-decomposition.md`](../research/2026-05-07-dataset-layer-harness-decomposition.md)
> **Original design (superseded by Mayor scope override)**: `docs/feature/refactor-dataset-layer-harness/design/design.md` at commit `981008f` — preserved in git history; intentionally not re-archived here because §2.1 file layout (per-module `_api/`, `_mappers.py`, `_http.py`) was overridden before any phase shipped.
> **Supersedes**: the stale `dc-4dp` proposal for a single `DatasetLayerApiClient` extraction.

## Summary

Decomposed the integration-test harness `backend/tests/integration/dataset_layer/harness.py` from a 749-LOC monolith with one facade class doing every API call inline into a layered structure of **per-API wrapper classes composed via DI** by a slim facade. Public surface is unchanged — every method named in research §6 still exists on `DatasetLayerHarness` with the same signature, and the back-compat re-exports (`parse_chat_event_frames`, `fetch_dev_user_jwt`, `mint_pat`, `revoke_pat`, `required_env_or_skip_reason`, `TableState`, `ChatEventTrace`) remain importable from the harness module. Existing call sites in `test_harness_sse.py`, `test_dataset_staging_layer.py`, `test_replay_idempotency.py`, and `test_wire_contract.py` required zero changes.

## Mayor scope override (defining decision)

The DESIGN doc (commit `981008f`) proposed splitting the decomposition across nine files: `harness.py` (slim facade) + `_http.py` + `_mappers.py` + `_api/{auth,projects,uploads,datasets,sessions,transforms,chat}.py`. **Mayor overrode that layout before Phase 1 dispatched: every class stays inline in `harness.py`, no new files.** The override drove three downstream consequences:

1. **Phase 3's slim-facade size target was relaxed** from "≤ 280 LOC" (per design §2.1) to "≤ 850 LOC, well-sectioned" — net reduction is smaller when extracted classes live in the same file as their consumer.
2. **`__all__` exports were verified by hand** at the end of Phase 3 instead of being implicit module-import boundaries — `parse_chat_event_frames` and the four token helpers had to remain reachable as module-level names.
3. **Bead descriptions for Phases 2–4 explicitly say "inline in harness.py"** to keep dispatched polecats from re-reading the original design's file-layout section as authoritative.

Rationale (informal, captured here because no ADR was opened — see "ADR decision" below): the harness is test infrastructure, not production code; collocation lowers the cognitive cost of reading a single test failure end-to-end. The cross-file decomposition optimised for production-style boundary clarity, but at this scale the navigation tax of seven `_api/` modules outweighed the structural benefit.

## Final shipped structure

`backend/tests/integration/dataset_layer/harness.py` (1104 LOC), top-level definitions in order:

| Layer | Definitions | Source phase |
|---|---|---|
| Mapper dataclasses | `ChatEventTrace`, `TableState`, `SessionState`, `TransformRecord` | Phase 1 (dc-wcy.5) |
| Module-level helpers | `bearer()`, `unwrap_jsonapi()`, `to_project_id()`, `to_dataset_id()`, `to_table_state()`, `to_session_state()`, `to_transform_records()`, `to_session_events_page()`, `_parse_v6_sse()`, `parse_chat_event_frames()` | Phase 1 (dc-wcy.5) |
| Per-API wrappers (composed via DI) | `AuthApi`, `ProjectsApi`, `UploadsApi`, `DatasetsApi`, `SessionsApi`, `TransformsApi`, `ChatApi` | Phase 2 (dc-wcy.6, 7 sequenced commits) |
| Facade | `DatasetLayerHarness` — lifecycle (`__aenter__`/`__aexit__`), assertion methods (`assert_distinct_values`, `assert_no_nulls`, `assert_column_type`, `assert_no_leading_trailing_whitespace`, `assert_exactly_once_via_replay`), retry-with-rephrase loop, AC1.4 raw-tool-call leak guard | Phase 3 (dc-wcy.7 — janitorial sweep on the Phase 2 surface) |
| Module-level token helpers | `fetch_dev_user_jwt`, `mint_pat`, `revoke_pat` (re-exports for back-compat) | unchanged from pre-refactor |
| Utilities | `_default_rephrase`, `required_env_or_skip_reason`, `_new_ulid_suffix` | unchanged |

The facade calls the wrappers; the wrappers never call the facade. Each wrapper takes its `httpx.AsyncClient`, the relevant base URL, and the relevant auth token at construction time — no shared mutable state across wrappers, which means a future "swap one wrapper for a fake" affordance comes for free if a test ever needs it (none does today).

### Public-API stability (Phase 2 acceptance gate)

Verified at Phase 3 close on commit `091a516`:
- All 14 public methods on `DatasetLayerHarness` retain identical signatures and return types (research §6 catalog).
- `parse_chat_event_frames` is reachable as `from backend.tests.integration.dataset_layer.harness import parse_chat_event_frames` — covers `test_harness_sse.py` and `test_wire_contract.py`.
- The four token helpers (`fetch_dev_user_jwt`, `mint_pat`, `revoke_pat`, `required_env_or_skip_reason`) remain module-level imports — covers `conftest.py`.
- `TableState` and `ChatEventTrace` remain importable as module attributes — covers any test asserting on the dataclass shapes.
- Integration suite green at every commit boundary inside Phase 2 (7-commit sequence).

## Delivery path (epic `dc-wcy`)

Five phases, one bead per phase per Mayor's convention. Phase 0 is independent; Phases 1 → 2 → 3 are linearly dependent; Phase 4 (this doc) follows landing.

| Bead | Title | Outcome | Commit(s) |
|---|---|---|---|
| `dc-wcy.4` | Phase 0 — Drop dead `count_by` | ✓ ~15 LOC removed; closes `dc-grb` | `9bb79b8` |
| `dc-wcy.5` | Phase 1 — Mapper dataclasses + `bearer` helper inline | ✓ ~150 LOC of mappers/helpers extracted from method bodies into module-level definitions; `tests/unit/test_mappers.py` added as characterization tests | `4d3c123` |
| `dc-wcy.6` | Phase 2 — Extract 6 API wrapper classes inline | ✓ shipped as **7 sequenced commits** inside one bead, one per wrapper, integration suite green at every commit | `75f381a` (AuthApi), `d277a6b` (ProjectsApi), `e02c933` (UploadsApi), `7b59ff1` (DatasetsApi), `8ca6535` (SessionsApi), `4d8188f` (TransformsApi), `091a516` (ChatApi.send_turn + slim facade) |
| `dc-wcy.7` | Phase 3 — Slim facade audit + cleanup | ✓ folded into the final commit of Phase 2 (`091a516`); dead private methods (`_drive_one_turn`, `_backend_headers`, `_agent_headers`) removed, imports tidied, `__all__` exports verified | `091a516` |
| `dc-wcy.8` | Phase 4 — Documentation + finalize (this doc) | ✓ this evolution doc + §7 update on `2026-05-01-api-driven-user-flow-tests.md` + `docs/feature/refactor-dataset-layer-harness/` removal | (this commit) |

### Dispatch hiccups (operational lesson)

`dc-wcy.6` and `dc-wcy.7` were initially closed as "no-changes" by their first-dispatch polecats (obsidian, jasper) because the worktrees they were sandboxed into did not have Phase 1 (`dc-wcy.5`) on their `origin/main` yet — the close-note on the first `dc-wcy.6` reads "Re-hook when dc-wcy.5 lands on origin/main." The Mayor re-dispatched `dc-wcy.6` to obsidian under a fresh molecule (`dc-wisp-ix1w`) once `4d3c123` had merged, and the work landed cleanly. **Lesson for future epics with linear phase dependencies:** the witness must verify "depends-on-N is on `origin/main`, not just on a refinery rebase branch" before re-hooking the next phase, otherwise the polecat will (correctly) close as "no-changes" and the witness will (correctly) re-spawn the same loop.

`dc-wcy.8` (this bead) hit the same shape from the opposite direction — it dispatched while `dc-wcy.6` was still parked on a stale `dc-wcy.5` worktree. The polecat (onyx) mailed the witness a three-option triage (A: document partial state, B: park, C: re-execute Phases 2–3 here); Mayor chose **B-modified** (park, do not close) and re-dispatched Phase 2 first. Phase 4 resumed against the actual post-Phase-2 harness state once `091a516` landed.

## ADR decision

**No ADR was opened** for this refactor. Per the bead descriptions and confirmed by Mayor: design + git history are sufficient artifacts for a test-infrastructure refactor of this scope. The Mayor scope override is captured here in the evolution doc rather than in `docs/adrs/` because (a) it does not affect runtime behavior, (b) it does not constrain any other module's design, and (c) future readers chasing "why is `harness.py` 1100 LOC instead of being split across `_api/`?" land here via git blame on the wrapper-class banner comments.

## Documentation back-propagation

`docs/evolution/2026-05-01-api-driven-user-flow-tests.md` §7 (Q3 — Worker driving and runner) had a 2026-05-01 snapshot of the harness public API that pre-dated this refactor. Phase 4 inserted a "Revised 2026-05-07 (epic `dc-wcy`)" callout under the §7 mechanics list documenting the inline-wrapper structure shipped here, while leaving the public-API code block intact (the public surface did not change).

`docs/research/2026-05-07-dataset-layer-harness-decomposition.md` had two cross-references to the original design path; both were rewritten in this finalize commit to point at this evolution doc and at the design's git-history coordinate (commit `981008f`).

## Outcome

- **Public API stability:** ✓ verified — all 14 methods + 5 module-level re-exports unchanged.
- **No `_api/` files, no `_mappers.py`, no `_http.py`:** ✓ verified — `find backend/tests/integration/dataset_layer -type f` returns the same file set as pre-refactor (plus the unit-test file Phase 1 added under `backend/tests/unit/`).
- **Integration suite green:** ✓ verified at every commit boundary inside Phase 2.
- **Net LOC delta on `harness.py`:** 749 → 1104 (+355). The increase is the cost of explicit class structure replacing implicit method organization; the trade-off was deliberate (Mayor scope override accepts the larger file in exchange for collocation).
- **Cognitive structure:** what used to be one 749-LOC class with 14 public methods + 6 private helpers is now seven small wrapper classes (each ~50–80 LOC) above a facade that does only lifecycle, assertions, and the retry loop. Bisecting a regression to a single endpoint family is now a class-search, not a method-search.
