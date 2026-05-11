<!-- DES-ENFORCEMENT : exempt -->
# Wave Decisions — Extract Dataset Query Port (DESIGN)

DWDs are durable design-wave decisions, ratified at design time and binding on downstream waves (DISTILL → DELIVER) unless explicitly superseded.

---

## DWD-1 — Single `QueryEnginePort` (Option α), not split

**Decision.** One Protocol, one adapter. Macro registration and query execution stay together inside `PgDuckDBQueryEngineAdapter` because DuckDB macros are **connection-scoped DDL** that must be issued on the same connection as the query that uses them.

**Binding effect on DISTILL.** Acceptance tests target `QueryEnginePort.execute_dataset_preview()` as the single seam. No separate `MacroRegistryPort` AC.

**Binding effect on DELIVER.** One adapter file, one Protocol declaration, one `probe()`.

---

## DWD-2 — Adapter package follows the existing `LakeRepository` convention

**Decision.** New package `backend/app/query_engine/`. Protocol declared in package `__init__.py`; adapter implementation in a sibling module. This mirrors `backend/app/repositories/lake/__init__.py` (Protocol) + `repository.py` (adapter), which is the **only** Protocol-typed port already in the repo.

**Rejected alternatives.**
- New top-level `backend/app/ports/` + `backend/app/adapters/` directories. Rejected because the repo's existing convention works, and Conway's-Law wisdom says "match the precedent unless it's broken." The lake-repository precedent is not broken.
- Putting the adapter under `backend/app/infra/` (which already contains `query_engine_secrets.py`). Rejected because `infra/` currently holds *infrastructure helpers*, not adapters with Protocols. Promoting adapters into `infra/` would muddy the categorization without clarifying anything.

**Binding effect on DELIVER.** New files land at:
- `backend/app/query_engine/__init__.py`
- `backend/app/query_engine/pg_duckdb_adapter.py`
- `backend/app/query_engine/exceptions.py`

---

## DWD-3 — `RepositoryContainer` is the wire-up point (no new container)

**Decision.** Add a `query_engine` lazy slot to the existing `RepositoryContainer` (in `backend/app/repositories/__init__.py`). The new adapter is technically not a *repository*, but the container is the established DI root and already hosts the conceptually-similar `LakeRepository`. Introducing an `AdapterContainer` parallel to `RepositoryContainer` is YAGNI for one new adapter.

**Binding effect on DELIVER.** `DatasetService.__init__` reads `repositories.query_engine` alongside `repositories.metadata` and `repositories.lake`.

**Forward note (non-binding).** A future refactor (NOT this feature) may split `RepositoryContainer` into `AdapterContainer` + `RepositoryContainer` once N≥3 non-repository adapters live there. Tracked as a tech-debt note, not a roadmap item.

---

## DWD-4 — `_FakeConnection` migrates with the code, not before

**Decision.** The four-class `_FakeConnection`/`_FakePool`/`_FakePoolAcquireCtx`/`fake_pool_factory` ladder currently in `backend/tests/models/test_dataset.py:837–916` migrates to `backend/tests/query_engine/test_pg_duckdb_adapter.py` **with shape preserved**. Test names rename from `test_query_preview_rows_*` to `test_execute_dataset_preview_*`. The SUT changes from `Dataset` to `PgDuckDBQueryEngineAdapter`. The fixture surface (`copy_from_query_calls`, `executed_sql`, `executed_args`) is unchanged.

**Iron Rule reminder.** The characterization tests pin the exact `outer_sql` / `inner_sql` constants and the macro-DDL shim. **They MUST NOT be modified to make the refactor pass.** If a test would fail under the new shape, the refactor is wrong, not the test.

**Binding effect on DELIVER.** Step 1 of the Mikado roadmap is "move tests, confirm green against current model code via temporary delegation." Only after that turns green does `Dataset.query_preview_rows` become a shim.

---

## DWD-5 — `Dataset.query_preview_rows` shim retained for one minor release

**Decision.** After extraction, `Dataset.query_preview_rows()` becomes a thin delegator:

```python
# CONCEPTUAL — illustration only, software-crafter writes the actual code
async def query_preview_rows(self, limit: int = 10) -> list[dict[str, Any]]:
    import warnings
    warnings.warn(
        "Dataset.query_preview_rows is deprecated; "
        "use QueryEnginePort.execute_dataset_preview",
        DeprecationWarning, stacklevel=2,
    )
    from app.query_engine import _legacy_default_adapter
    return await _legacy_default_adapter().execute_dataset_preview(self, limit)
```

The shim is removed in the next minor release after the deprecation warning has been visible for one cycle.

**Binding effect on DELIVER.** Shim is part of the **same commit** as the extraction (preserves git bisect). Removal is a **separate, later commit/PR**, not part of this feature's scope.

---

## DWD-6 — Earned-Trust contract: probe + three enforcement layers

**Decision.** `QueryEnginePort.probe()` is mandatory. The composition root (`RepositoryContainer.query_engine` first access, or an explicit lifespan call in `app/main.py`) follows the **wire then probe then use** invariant. Probe failure → structured `health.startup.refused` event, FastAPI startup raises.

**Probes (5):**
1. Acquire and release one connection from the pool.
2. Run `SELECT 1` — basic Postgres liveness.
3. Run `SELECT duckdb.raw_query('SELECT 1')` — verifies pg_duckdb extension is loaded.
4. Round-trip `COPY (SELECT 1::text) TO STDOUT` — verifies the COPY-text path.
5. Register one macro and call it on a throwaway connection — verifies macro DDL still works against the pinned pg_duckdb version.

**Enforcement layers (Principle 11 + 12 self-application):**
- **Subtype** — `mypy` plus `typing.Protocol`. The composition root site assigns adapter to `QueryEnginePort`-typed variable; mypy fails if `probe()` is missing.
- **Structural** — `pytest-archon` rule: `app.models.*` MUST NOT import `asyncpg`, `app.utils.sql_functions`, or `app.database.get_query_engine_pool`. A second rule: only `app.query_engine.*` MAY import `asyncpg`.
- **Behavioral** — CI gold-test that monkeypatches `asyncpg.create_pool` to raise `ConnectionRefusedError`, asserts startup refuses with the structured `health.startup.refused` event.

**Binding effect on DISTILL.** AC for "adapter probe runs and refuses startup on failure" is in scope.

---

## DWD-7 — ADR-007 (Ibis) is preserved verbatim

**Decision.** Ibis remains the SQL generator. The adapter consumes the **string output** of `Dataset.staging_sql` (which is Ibis-compiled). Ibis itself is not imported by the adapter. ADR-007 needs no amendment.

**Binding effect on DELIVER.** Adapter MUST NOT import `ibis`. Enforced via `pytest-archon` rule.

---

## DWD-8 — Phase-2 surface fence

**Decision.** This DESIGN does not modify, propose changes to, or take dependencies on any file under:
- `backend/app/use_cases/project/_dbt/`
- `backend/tests/use_cases/project/_dbt/`
- `backend/tests/integration/dataset_layer/eject/`
- `backend/tests/integration/dataset_layer/harness.py`
- `tests/acceptance/dbt-test-validation/`
- `backend/app/repositories/metadata/repository.py` (parallel architect dispatch owns this)

`ALL_MACROS` (in `app.utils.sql_functions`) is read-only here; Phase 2's dbt macros (`app/use_cases/project/_dbt/macros_sql.py`) are a **separate** catalog for the dbt-project-export and are not affected.

**Binding effect on DELIVER.** Roadmap MUST NOT schedule any task that touches the fenced files.
