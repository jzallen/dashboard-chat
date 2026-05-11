<!-- DES-ENFORCEMENT : exempt -->
# Tech-debt review — high-churn files

**Date:** 2026-05-10
**Method:** Read-only review of top 6 hotspots by commit frequency over repo lifetime, performed by `nw-software-crafter-reviewer` while Phase 2 of the dbt-test-validation feature was running in a parallel headless process.
**Excluded:** Phase 2 in-flight files: `schema_yml.py`, `_dbt/__init__.py`, `test_yaml_generators.py`, eject `parser.py`, eject `seeder.py`, integration `harness.py`, `dbt_test_validation_steps.py`.

## Summary

The six highest-churn files cluster into two debt themes: **Repository class bloat (L3)** and **test-patchability debt (L2/L4)**. The `MetadataRepository` has grown to an 866-line god object handling 8 distinct aggregate types with 35+ methods. The `http_controller` carries ~45 module-level use-case aliases purely for backward-compatible test patching — a warning sign of brittle test architecture. The `Dataset` model is largely healthy but carries query execution logic that risks coupling domain logic to query-engine specifics. Overall severity: **medium** — these files work but exhibit low cohesion and high test friction.

## Findings

### 1. `backend/app/repositories/metadata/repository.py` (26 commits)

- **Smell:** God object. Single repository class handles 8 aggregates (projects, datasets, transforms, sessions, memories, views, reports, organizations). 35+ methods, 866 lines. No cohesion boundary. Hard to isolate aggregate operations for testing.
- **RPP level:** L3
- **Recommendation:** Split into focused repository classes per aggregate (`ProjectRepository`, `DatasetRepository`, `ViewRepository`, etc.). Share session via composition. Reduces method surface per class from 35 → ~5–8.
- **Effort:** M
- **Confidence:** High

### 2. `backend/app/controllers/http_controller.py` (32 commits)

- **Smell:** Test-patchability debt. Module carries 8 module-level use-case aliases (`dataset_use_cases`, `project_use_cases`, etc.) and 2 helper re-exports (`_serialize`, `_error_response`) solely so tests can `monkeypatch` them. The file header (lines 5–24) explicitly notes removal is blocked until tests rewrite patches to target per-context controllers. Breaking-change liability.
- **RPP level:** L2 (symptom) / L4 (root cause)
- **Recommendation:** Run `nw-test-refactoring-catalog` L1–L3 on `test_http_controller.py` and per-context characterization tests. Batch-rewrite patches to target per-context controllers. Then remove the alias block. Eliminates the 18-line import shim.
- **Effort:** M (depends on test count)
- **Confidence:** Medium (requires test audit first)

### 3. `backend/app/models/dataset.py` (30 commits)

- **Smell:** Query execution leakage into the domain model. `query_preview_rows` (async, ~40 lines) and `_needs_custom_case_macros` (~12 lines) couple `Dataset` to query-engine mechanics (asyncpg, pg_duckdb, COPY protocol, DuckDB macros). Belongs in a use case or query adapter, not the model.
- **RPP level:** L5 (architectural seam)
- **Recommendation:** Extract `query_preview_rows` to `QueryEngineAdapter.execute_dataset_query(dataset: Dataset) → list[dict]`. Move macro-application logic to the infrastructure layer. `Dataset` stays pure; query-engine coupling moves to a port boundary.
- **Effort:** M
- **Confidence:** High

### 4. `backend/app/main.py` (31 commits)

- **Smell:** Startup logic density. `lifespan` coroutine (lines 74–112) handles 6 concerns: DB init, plugin registry, query engine provisioner config, dev org seeding, Session Event Reader installation, sync processor startup. No extraction. If any concern changes, the entire lifespan must be re-tested.
- **RPP level:** L2
- **Recommendation:** Extract each concern into named functions (`init_db`, `init_plugins`, `configure_query_engine`, `seed_dev_org`, `install_event_reader`, `start_sync_processor`). `lifespan` becomes a ~40-line orchestrator with one responsibility per call.
- **Effort:** S
- **Confidence:** High

### 5. `backend/app/routers/datasets.py` (19 commits)

- **Smell:** Anemic router. Minor: query params (`page[after]`, `page[size]`) and validation (`ge=1, le=100`) repeated across endpoints. Opportunity to consolidate into a pydantic model.
- **RPP level:** L1
- **Recommendation:** Create `DatasetListParams` pydantic model with pagination defaults. Replace inline `Query()` parameters. Centralizes validation; improves API contract clarity. Low risk.
- **Effort:** S
- **Confidence:** Medium (nice-to-have)

### 6. `backend/app/use_cases/dataset/create_dataset_from_upload.py` (18 commits)

- **Smell:** None detected. Healthy use case.
- **RPP level:** —
- **Recommendation:** No refactoring needed. Exemplifies good use-case structure.
- **Effort:** —
- **Confidence:** High

## Recommended order

1. **First** — Extract `MetadataRepository` into per-aggregate classes (Finding 1). Highest ROI; unlocks downstream refactoring by making tests faster to write and boundaries clearer.
2. **Second** — Run test refactoring on `http_controller` patches (Finding 2). Medium-effort win. Can proceed in parallel with Finding 1.
3. **Third** — Extract query logic from `Dataset` model (Finding 3). Unblocks domain model clarity.
4. **Fourth** — Extract `main.py` startup (Finding 4). Low-effort hygiene win. Good follow-up after structural refactors.
5. **Optional** — Consolidate `datasets.py` router parameters (Finding 5). Trivial L1 hygiene; batch into minor cleanup if touching routers for other reasons.

## What I did NOT find

- **No test structure debt** in `Dataset` or `create_dataset_from_upload.py` — boundaries clear, well-tested.
- **No cyclic imports** — all follow expected layers (models → repos → controllers → routers).
- **No missing validation** — SQL validated via `validate_condition_sql()`; exceptions wrapped consistently.
- **No auth/security gaps** — checks at router/controller boundary (expected).
- **No async/await antipatterns** — all async operations correct.
- **No N+1 query smells** — `selectinload`/`joinedload` used correctly.

## Out of scope

- Major architectural refactoring of session/memory lifecycle (warrants its own `/nw-design` pass).
- Plugin registry integration refactoring.
- Complete `HTTPController` rewrite into native FastAPI dependencies.
- DuckDB macro extraction into a macro registry (would require coordination with the Phase 2 work currently running).
