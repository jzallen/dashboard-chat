# ADR-021: Extract Dataset Query Engine Port from `Dataset` Domain Model

## Status

Proposed (2026-05-10) — pending peer review by Atlas (`solution-architect-reviewer`)

## Context and Problem Statement

`backend/app/models/dataset.py` currently holds two methods that couple a frozen-dataclass domain model (per ADR-005) to query-engine infrastructure:

1. **`query_preview_rows()`** (async, ~40 lines) — depends on `app.database.get_query_engine_pool` (asyncpg), `app.utils.sql_functions.ALL_MACROS` (DuckDB DDL), pg_duckdb's `duckdb.raw_query` shim, and asyncpg's `copy_from_query` COPY-to-stdout protocol. The COPY route exists for documented reasons: asyncpg's mandatory Describe phase rejects DuckDB's UNKNOWN type from `duckdb.query()`, and pg_duckdb's planner only binds `to_json(t)` against the direct `read_parquet` alias (see `backend/app/repositories/lake/_pg_duckdb_query.py` for the canonical write-up).

2. **`_needs_custom_case_macros()`** (~12 lines) — predicate over `Dataset.transforms` that gates macro registration in (1).

The tech-debt hotspot review (`docs/research/tech-debt-hotspot-review.md`, Finding 3, RPP L5) flagged this as the single architecturally-significant smell in the file: the model file has accumulated 30 commits over repo lifetime, most of them protocol fixes (dc-f8m, dc-dex, dc-6gg) that should have been absorbed by an adapter boundary the model never had.

ADR-005 specifies frozen dataclasses for domain models; ADR-007 specifies Ibis as the SQL generator; ADR-003 specifies DuckDB + pg_duckdb for analytical queries. None of these say the model should own *execution*. The current shape is a violation by accretion, not by design.

## Decision Drivers

- **ADR-005 compliance** — domain models hold business logic, not infrastructure imports.
- **ADR-007 preservation** — Ibis remains the SQL generator; this refactor must not disturb the Ibis pipeline.
- **Testability** — `Dataset` unit tests should not need a four-class asyncpg fake.
- **COPY-route correctness** — the asyncpg/pg_duckdb Describe-phase workaround is non-negotiable. It must move byte-for-byte.
- **Convention reuse** — the repo already has one Protocol-typed port (`LakeRepository` in `backend/app/repositories/lake/__init__.py`); the new boundary should mirror it rather than invent a new structure.
- **Earned Trust (Principle 12)** — every adapter must ship with a `probe()` and the composition root must follow "wire then probe then use".
- **Architectural enforcement (Principle 11)** — language-appropriate tooling must prevent regression of the dependency direction.

## Considered Options

1. **Single `QueryEnginePort` (Protocol) + `PgDuckDBQueryEngineAdapter`** (selected) — Option α
2. **Split into `PreviewQueryAdapter` + `MacroRegistryAdapter`** — Option β
3. **Inject a `QueryRunner` callable into `Dataset`** — Option γ

### Option 1 — Single `QueryEnginePort` (selected)

A new package `backend/app/query_engine/` with:
- `__init__.py` declaring `QueryEnginePort` (typing.Protocol) with `execute_dataset_preview(dataset, limit) -> list[dict]` and `probe() -> None`.
- `pg_duckdb_adapter.py` implementing the Protocol against asyncpg + pg_duckdb + the DuckDB macro catalog.
- `exceptions.py` with `QueryEngineError` and `MacroRegistrationError`.

`Dataset` keeps `staging_sql`/`display_sql` (Ibis-compiled) and `requires_custom_case_macros()` (renamed public predicate). The adapter reads these as inputs.

- Good, because it matches the existing `LakeRepository` Protocol convention — no new directory layout, no new container, minimal cognitive load for the next reader.
- Good, because macro registration and query execution stay co-located, which is correct: DuckDB macros are connection-scoped DDL and **must** be issued on the same connection as the query that consumes them.
- Good, because it produces a single `probe()` covering one fault-injection matrix rather than two.
- Bad, because in principle a future swap of the macro source (e.g., extracted to a UDF library) lands in the same class as a swap of execution route. Mitigated: those are both adapter-internal concerns, and the Protocol surface stays the same.

### Option 2 — Split `PreviewQueryAdapter` + `MacroRegistryAdapter`

Two Protocols, two adapters. Macro registration becomes a separate concern wired through DI.

- Good, because each adapter has a narrower Single Responsibility surface.
- Good, because the macro catalog could be unit-tested without an asyncpg fake.
- Bad, because **macros must be registered on the same connection as the query that uses them** (DuckDB session-scoped DDL). Splitting them into two adapters re-introduces exactly the coordination they were extracted from — the macro adapter would have to receive the *same connection instance* the query adapter is about to use, defeating the boundary.
- Bad, because two ports → two `probe()` calls → two fault-injection matrices → twice the wiring at the composition root for a separation that has no consumer demand.

Rejected on YAGNI + correctness grounds.

### Option 3 — Inject a `QueryRunner` callable into `Dataset`

Keep `query_preview_rows` on the model but inject a `Callable[[str, ...], Awaitable[list[dict]]]` at construction time.

- Good, because call sites change minimally.
- Bad, because frozen dataclasses (ADR-005) shouldn't carry behavioural collaborators — that re-creates the coupling under a different name.
- Bad, because `Dataset.from_record()` would need a runner argument, polluting the construction surface across every caller in the repo.

Rejected on architectural-style grounds (ADR-005 conflict).

## Decision Outcome

**Chosen: Option 1 (single `QueryEnginePort`).**

The decision matches the repo's only existing port convention (`LakeRepository`), preserves the COPY-route + macro coordination that production correctness depends on, and produces the smallest credible boundary that addresses the seam.

### Consequences

**Positive**
- `Dataset` returns to a pure ADR-005 frozen-dataclass shape with no infrastructure imports.
- Asyncpg + pg_duckdb + COPY-route knowledge is isolated in one package, behind one Protocol, with one mock surface.
- Test fixture relocation (`_FakeConnection` ladder) is mechanical — same shape, new SUT.
- Earned-Trust contract is explicit: `QueryEnginePort.probe()` exercises the pool, pg_duckdb extension presence, COPY path, and macro DDL — each a known historical failure surface (dc-f8m, dc-dex, dc-6gg).
- ADR-007 (Ibis) untouched; adapter consumes Ibis-compiled SQL strings.

**Negative**
- One indirection (Protocol dispatch) on the preview-row hot path. Empirically negligible — the bottleneck is DuckDB execution, not Python method dispatch.
- `RepositoryContainer` now hosts a non-repository member (`query_engine`). Captured as a forward-looking concern in DWD-3; an `AdapterContainer` split is deferred until ≥3 non-repository adapters live there.
- A migration shim on `Dataset.query_preview_rows` lives for one minor release before removal — costs one `DeprecationWarning` and a small bounce-through call.

### Architectural enforcement (Principle 11)

- **Subtype layer** — `mypy` + `typing.Protocol`. Composition root assigns the adapter to a `QueryEnginePort`-typed variable; mypy fails if `probe()` or `execute_dataset_preview()` is missing.
- **Structural layer** — `pytest-archon` rules: (a) `app.models.*` MUST NOT import `asyncpg`, `app.utils.sql_functions`, or `app.database.get_query_engine_pool`; (b) only `app.query_engine.*` MAY import `asyncpg`; (c) `app.query_engine.*` MUST NOT import `ibis` (preserves ADR-007's separation: Ibis generates, the adapter executes).
- **Behavioral layer** — CI gold-test that monkeypatches `asyncpg.create_pool` to raise `ConnectionRefusedError` and asserts startup refuses with `health.startup.refused`.

These three layers answer different questions and a single-layer bypass is caught by at least one of the others, per Principle 12's self-application clause.

### Earned-Trust contract (Principle 12)

`QueryEnginePort.probe()` is mandatory. Composition root invariant: **wire then probe then use**. Probe failure → structured `health.startup.refused` event; FastAPI startup raises.

Probe steps:
1. Acquire and release one connection from `get_query_engine_pool()`.
2. `SELECT 1` — Postgres liveness.
3. `SELECT duckdb.raw_query('SELECT 1')` — pg_duckdb extension liveness.
4. Round-trip `COPY (SELECT 1::text) TO STDOUT` — COPY-text path liveness.
5. Register one macro and call it on a throwaway connection — macro DDL liveness against the pinned pg_duckdb version.

Fault-injection scenarios the probe must survive (gold-test catalog): pool unreachable; pg_duckdb extension absent; macro DDL syntax drift on extension upgrade.

## Confirmation

After DELIVER:

- `grep -r "import asyncpg" backend/app/models/` returns nothing.
- `grep -r "from app.utils.sql_functions" backend/app/models/` returns nothing.
- `mypy backend/app` passes with the composition-root assignment to `QueryEnginePort`.
- `pytest backend/tests/query_engine/` passes with the relocated `_FakeConnection` ladder.
- The existing characterization tests pinning `outer_sql` and `inner_sql` constants pass against the adapter, byte-for-byte.
- `pytest-archon` rules listed above are present in `backend/tests/architecture/test_dependency_rules.py` (or equivalent).
- The CI gold-test for `health.startup.refused` is in place.
- Out-of-tree callers, if any, see the `DeprecationWarning` from the shim.

## Related

- ADR-003 — DuckDB / pg_duckdb for analytical queries (the engine being adapted).
- ADR-005 — Frozen dataclasses over Pydantic for domain models (the shape this restores).
- ADR-007 — Ibis for SQL generation (preserved verbatim; adapter consumes Ibis-compiled strings).
- ADR-019 — Eject-then-test validation (parallel Phase-2 work; surface-fenced, no overlap).
- `docs/research/tech-debt-hotspot-review.md` Finding 3 — the trigger for this ADR.
- `backend/app/repositories/lake/_pg_duckdb_query.py` — the canonical write-up of the Describe-phase mismatch the COPY route works around.
- `backend/app/repositories/lake/__init__.py` — the existing `LakeRepository` Protocol convention this ADR mirrors.
