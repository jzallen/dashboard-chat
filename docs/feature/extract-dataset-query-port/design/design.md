<!-- DES-ENFORCEMENT : exempt -->
# Extract Dataset Query Port — DESIGN

**Feature slug:** `extract-dataset-query-port`
**Wave:** DESIGN (brownfield refactor entry)
**Trigger:** `docs/research/tech-debt-hotspot-review.md` Finding 3 (RPP L5, 30 commits)
**Author:** Morgan (`nw-solution-architect`)
**Status:** Proposed — awaiting peer review (Atlas) → DISTILL
**Mode:** Propose (autonomous)
**Related ADR:** ADR-021 (Proposed)

---

## §0 Confirmation checklist

- [x] Phase 2 surface untouched (verified — read-only on `dataset.py`, `database.py`, `sql_functions.py`, `lake/`, ADR-007, brief).
- [x] No proposed file in scope overlaps `app/use_cases/project/_dbt/` or `repositories/metadata/repository.py`.
- [x] ADR-007 (Ibis as SQL generator) preserved — Ibis still produces `staging_sql`; only execution moves.
- [x] COPY-from-stdout path retained (motivated by `_pg_duckdb_query.py` Describe/Execute mismatch — non-negotiable).
- [x] `_FakeConnection` test shape preserved in §5.
- [x] Hexagonal compliance: Protocol-typed port, dataclass stays pure.
- [x] Earned-Trust contract: every adapter ships with `probe()` (§6).
- [x] Architectural enforcement tooling specified per language (§6).

---

## §1 Problem statement

`Dataset.query_preview_rows()` (lines 179–221 of `backend/app/models/dataset.py`) and its helper `_needs_custom_case_macros()` (lines 223–233) couple a **frozen-dataclass domain model** (ADR-005) to four pieces of infrastructure:

1. The asyncpg connection pool (`get_query_engine_pool()` from `app.database`).
2. pg_duckdb's `duckdb.raw_query($1)` macro-DDL shim.
3. asyncpg's `copy_from_query()` COPY-to-stdout protocol — the documented workaround for the Describe-phase UNKNOWN-type bug already explained in `_pg_duckdb_query.py`.
4. The DuckDB macro catalog (`ALL_MACROS` from `app.utils.sql_functions`).

Effects:

- **Testability**: tests must monkeypatch `app.database.get_query_engine_pool`, build a four-class `_FakeConnection`/`_FakePool`/`_FakePoolAcquireCtx` ladder (lines 837–916 of `test_dataset.py`), and assert on protocol-internal calls (`copy_from_query_calls`).
- **Hexagonal violation**: per ADR-005, `Dataset` is a behaviour-rich frozen dataclass — **not** an aggregate root that owns its persistence. Currently it owns its **execution**, which is worse: it pulls asyncpg into the model layer.
- **Churn**: 30 commits over repo lifetime, the highest of any non-Phase-2 model. Most are protocol fixes (dc-f8m, dc-dex, dc-6gg) — exactly the kind of churn an adapter boundary should absorb.

The seam is real and load-bearing. The COPY route is correct and documented; this design preserves it intact.

---

## §2 Architectural options

The repo already has a **Protocol-typed port pattern** (`backend/app/repositories/lake/__init__.py` declares `LakeRepository` as `typing.Protocol`; `MinIOLakeRepository` is the adapter). There is no `ports/` or `adapters/` directory — the convention is **Protocol in the package `__init__.py`, adapter implementation in `repository.py`**. This design follows that convention.

### Option α — Single `QueryEngineAdapter` port

One Protocol, one adapter. The dataset model loses both methods.

```python
# backend/app/query_engine/__init__.py  (NEW)
class QueryEnginePort(Protocol):
    async def execute_dataset_preview(
        self, dataset: Dataset, limit: int = 10
    ) -> list[dict[str, Any]]: ...
    async def probe(self) -> None: ...

# backend/app/query_engine/pg_duckdb_adapter.py  (NEW)
class PgDuckDBQueryEngineAdapter:
    """asyncpg + pg_duckdb implementation. Owns COPY-route + macro registration."""
```

The adapter is the only place that knows about COPY, asyncpg, `ALL_MACROS`, and pg_duckdb. `Dataset` exposes `staging_sql`/`display_sql` (Ibis-compiled, ADR-007) and a pure predicate `requires_custom_case_macros` (renamed, no leading underscore — it is now part of the model's public API, consumed by adapters).

- **Pros:** Smallest change; matches existing `LakeRepository` convention; one Protocol means one `probe()`; macro registration and COPY route stay co-located (they are the same connection's pre-flight + flight).
- **Cons:** Macro registration is a separable concern in principle. Mixing them in one adapter means a future swap of macro source (e.g., extracted to a UDF library) touches the same class as a swap of execution route.

### Option β — Split `PreviewQueryAdapter` + `MacroRegistryAdapter`

Two Protocols. Macro registration becomes a separate concern wired through DI.

- **Pros:** Single Responsibility per adapter; macro catalog could be unit-tested without an asyncpg pool fake.
- **Cons:** **Macros must be registered on the same connection as the query that uses them** (DuckDB session-scoped DDL — see line 199–205 of `dataset.py`). Splitting them into two adapters re-introduces the coordination they were extracted from. Two ports, two `probe()` calls, two fault-injection matrices, twice the wiring at the composition root for a separation that has no consumer demand. **Premature decomposition.**

### Option γ — Inject a `QueryRunner` callable into `Dataset`

Keep `query_preview_rows` on the model but inject a `Callable[[str, ...], Awaitable[list[dict]]]` at construction time.

- **Pros:** Minimal disturbance to call sites; fits dataclass mutation patterns via `replace()`.
- **Cons:** Frozen dataclasses (ADR-005) shouldn't carry behavioural collaborators — that re-creates the coupling under a different name. `Dataset.from_record()` would need a runner argument, polluting the construction surface across every caller. **Rejected on architectural-style grounds, not invented to pad option count** — this is the one a less-disciplined refactor would land on.

---

## §3 Reuse Analysis

| Existing artefact | Disposition | Rationale |
|---|---|---|
| `Dataset.staging_sql` / `display_sql` (Ibis-compiled, ADR-007) | **REUSE AS-IS** | Pure properties; the port consumes them as inputs. |
| `Dataset._s3_path()` | **REUSE AS-IS** (becomes public `s3_path()` since adapter calls it) | Path derivation is domain knowledge; not query mechanics. |
| `Dataset._needs_custom_case_macros()` | **EXTEND** — rename to `requires_custom_case_macros` (public predicate) | Domain predicate over transforms; remains on `Dataset`, becomes public. |
| `Dataset.query_preview_rows()` | **DEPRECATE** then **REMOVE** | Migration shim retained one release; in-scope caller (`DatasetService.fetch_dataset`) updated immediately. |
| `app.database.get_query_engine_pool` | **REUSE AS-IS** | Pool stays where it is; the adapter takes the pool as a constructor dep. |
| `app.utils.sql_functions.ALL_MACROS` | **REUSE AS-IS** | Adapter imports it; module is the canonical macro catalog. |
| `app.repositories.lake._pg_duckdb_query` | **REUSE AS-IS** | Already documents the Describe-phase mismatch. Adapter cites it. |
| `LakeRepository` Protocol pattern (`repositories/lake/__init__.py`) | **REUSE AS PRECEDENT** | New `QueryEnginePort` follows the same shape. |
| `_FakeConnection` test fixture (`test_dataset.py` lines 837–916) | **EXTEND** — relocates to `tests/query_engine/` and tests the adapter, not the model | Same protocol surface, same assertions; only the SUT changes. |
| `DatasetService.fetch_dataset` (only in-tree caller of `query_preview_rows`) | **EXTEND** — receives `query_engine: QueryEnginePort` via repository container | Single call site; mechanical change. |

**No new component is justified beyond `QueryEnginePort` + `PgDuckDBQueryEngineAdapter`.** Macro extraction (Phase 2 carve-out hint in tech-debt review §6) is **explicitly out of scope** — coordinated with the parallel dispatch via the §1 surface fence.

---

## §4 Recommendation

**Adopt Option α — single `QueryEngineAdapter` port.**

**Rationale (constraint-quantified):**

- ADR-005 says domain models hold business logic, not infrastructure. 100% of the smell is the asyncpg/COPY/macro coupling — addressed by α.
- The repo's *only* existing Protocol-port pattern (`LakeRepository`) is the one α mirrors. Inverse Conway maneuver is **not** needed; team-of-one ownership of the adapter matches the team-of-one ownership pattern of the rest of the backend.
- Option β solves a problem nobody has and re-creates a coordination one we just removed.
- Option γ violates ADR-005.

**Layout:**

```
backend/app/query_engine/
├── __init__.py                      # QueryEnginePort (Protocol) + factory
├── pg_duckdb_adapter.py             # PgDuckDBQueryEngineAdapter (asyncpg + COPY + macros)
└── exceptions.py                    # QueryEngineError, MacroRegistrationError
```

`RepositoryContainer` (in `repositories/__init__.py`) gains a `query_engine` lazy slot mirroring `lake`. The adapter's pool dependency resolves via the existing `get_query_engine_pool()`.

**Effort:** **M** (medium). New package + Protocol + adapter (~100 LOC) + 1 caller migration + test relocation + ADR. No new dependencies, no new ports beyond α.

---

## §5 Migration / call-site impact

**Single in-tree caller**: `backend/app/use_cases/dataset/dataset_service.py:64` — `await dataset.query_preview_rows(limit=preview_limit)`.

**Migration steps (DELIVER-wave plan; not executed here):**

1. Add `QueryEnginePort` + `PgDuckDBQueryEngineAdapter`. Tests for the adapter use a **renamed `_FakeConnection`** (now `_FakePgDuckDBConnection` under `backend/tests/query_engine/`) — same shape, same `copy_from_query_calls` assertions, same macro-registration assertions. The migration is mechanical: replace `Dataset` SUT with `PgDuckDBQueryEngineAdapter` SUT and pass `Dataset(...)` as input.
2. Wire `query_engine` into `RepositoryContainer` (it is technically *not* a repository, but the container is already the de-facto DI root; introducing a parallel `AdapterContainer` is YAGNI).
3. Update `DatasetService.fetch_dataset` to call `self._query_engine.execute_dataset_preview(dataset, limit)`.
4. **Migration shim on `Dataset`** (one release): `Dataset.query_preview_rows` becomes a thin delegator that imports the adapter and calls it, emitting a `DeprecationWarning`. This preserves out-of-tree callers (none found, but defensive).
5. Test patches in `test_get_dataset.py` (`patch.object(Dataset, "query_preview_rows", ...)`) migrate to patching the injected adapter — these tests live in scope of this design.
6. Remove the shim and `_needs_custom_case_macros` ceremony from `Dataset` once the deprecation cycle elapses (next minor).

**`_FakeConnection` preservation guarantee:** the protocol surface (`execute(sql, *args)`, `copy_from_query(sql, inner_sql, *, output)`) is identical; only the file moves and the SUT changes. Coverage of the COPY-from-stdout path **strictly increases** because the adapter unit tests no longer have to share a fixture file with 800 lines of unrelated `Dataset` tests.

---

## §6 Quality attributes

| Attribute (ISO 25010) | How addressed |
|---|---|
| **Maintainability / Modularity** | `Dataset` returns to pure domain; query engine concerns isolated in `app/query_engine/`. |
| **Maintainability / Testability** | Adapter is the only mock target. Domain tests for `Dataset` no longer need an asyncpg fake. |
| **Reliability / Correctness (async)** | COPY-from-stdout path **transcribed verbatim** — no behaviour change. Adapter unit tests pin the exact SQL shapes (outer + inner). |
| **Performance Efficiency** | One indirection added (method call through Protocol). DuckDB macro registration cost unchanged (same connection scope). No measurable hot-path impact. |
| **Compatibility (ADR-007 Ibis)** | Ibis remains the SQL generator. Adapter consumes Ibis-compiled `staging_sql` as a string. Zero ADR-007 conflict. |
| **Earned Trust (Principle 12)** | `QueryEnginePort.probe()` mandatory. Composition root invariant: "wire then probe then use". Probes: (1) acquire-and-release a connection from the pool; (2) `SELECT 1`; (3) `SELECT duckdb.raw_query('SELECT 1')` — verifies pg_duckdb is live; (4) round-trip `COPY (SELECT 1::text) TO STDOUT` — verifies the COPY path; (5) register-then-call one macro on a throwaway connection — verifies macro DDL still works against the pinned pg_duckdb version. **Fault-injection scenarios** the probe must survive (gold-test): pool unreachable → structured `health.startup.refused`; pg_duckdb extension absent → same; macro DDL syntax drift on extension upgrade → same. |
| **Architectural enforcement (Principle 11)** | (a) `mypy` + `Protocol` at composition root — adapter must satisfy `QueryEnginePort`. (b) `pytest-archon` rule: `app.models.*` MUST NOT import `asyncpg`, `app.utils.sql_functions`, or `app.database.get_query_engine_pool`. (c) `pytest-archon` rule: only `app.query_engine.*` MAY import `asyncpg`. (d) CI gold-test: simulate `asyncpg` import error and assert startup refuses with `health.startup.refused`. |

---

## §7 Risks + mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **COPY-route regression** (the asyncpg/pg_duckdb Describe-phase mismatch is the entire reason this code is shaped weirdly). | **Critical** | Adapter unit tests assert exact `outer_sql`/`inner_sql` constants (pinned in `test_dataset.py:963–970` today; relocated unchanged). DELIVER MUST start by **moving these characterization tests first**, confirming green, then refactoring (Mikado-style). |
| **Macro registration is connection-scoped DuckDB DDL** — splitting macros from execution would break the contract. | High (in β) / N/A in α | β rejected on this exact ground. α keeps them on the same connection. |
| **DI confusion** — the new adapter is not a repository but rides `RepositoryContainer`. | Medium | ADR-021 documents the precedent (the lake repository is also more adapter than repository). A future cleanup separating `RepositoryContainer` into `AdapterContainer` + `RepositoryContainer` is captured as a follow-up note, not blocking. |
| **Out-of-tree caller of `Dataset.query_preview_rows`** breaks during shim removal. | Low | Repo-wide grep found 1 caller (`dataset_service.py`) plus tests. Shim retained for one minor release. |
| **Phase 2 collision** — `_dbt/` macros logic touches `ALL_MACROS` evolution. | Low | `ALL_MACROS` import is read-only from this design's adapter. Phase 2 owns `_dbt/macros_sql.py`, which is a separate macro catalog for dbt-export. No shared mutation surface. |
| **Test churn during migration** — `test_get_dataset.py` patches `Dataset.query_preview_rows`. | Low (mechanical) | In-scope; AC1 in DISTILL will require updated patches before code moves. |

---

## Word count

~1,180 words (within 1,200 cap).
