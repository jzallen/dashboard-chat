<!-- DES-ENFORCEMENT : exempt -->
# Upstream Changes — Extract Dataset Query Port

Formal record of changes this design proposes to artefacts owned upstream of DESIGN (architecture brief, ADR index, cross-cutting modules). Per project convention, an "upstream change" is any modification to:

- `docs/product/architecture/brief.md`
- `docs/decisions/adr-*.md` (additions or supersessions)
- Cross-cutting helper modules consumed by ≥2 features

---

## 1. New ADR — ADR-021

**File:** `docs/decisions/adr-021-extract-dataset-query-port.md`
**Status:** Proposed
**Title:** Extract Dataset Query Engine Port from `Dataset` Domain Model
**Numbering rationale.** Highest existing ADR is **019** (`adr-019-eject-then-test-validation.md`, ratified by Phase-2's DESIGN wave). The parallel architect dispatch (metadata-repository split, `refactor-metadata-repository-split` slug per the task brief) is also expected to mint a new ADR. Per the dispatch instructions, this design takes **highest+2** for collision safety. If the parallel ADR merges first as 020, this one stays 021. If neither has merged when both PRs land, the second-merged renumbers per the precedent in this repo's history.

---

## 2. Architecture brief — `## Application Architecture` append

A new sub-section will be appended to `docs/product/architecture/brief.md` under `## Application Architecture` → `### Application-architecture features`, adjacent to the existing `dbt-test-validation` entry. Proposed content (to be written by the DELIVER-phase finalizer when this feature ships, NOT by this DESIGN — the brief is append-only across waves and reflects ratified state):

```markdown
#### `extract-dataset-query-port` (DESIGN — 2026-05-10)

**Author:** Morgan (nw-solution-architect)
**ADR:** ADR-021 (Proposed)
**Trigger:** docs/research/tech-debt-hotspot-review.md Finding 3 (RPP L5)
**Status:** Awaiting peer review (Atlas) → DISTILL

**Decision summary.** Extract `Dataset.query_preview_rows()` and the
`_needs_custom_case_macros()` helper into a new `QueryEnginePort` (Protocol)
+ `PgDuckDBQueryEngineAdapter` under `backend/app/query_engine/`. Pattern
mirrors the existing `LakeRepository` Protocol convention. Domain model
returns to pure ADR-005 frozen-dataclass shape; asyncpg + pg_duckdb COPY
route + macro DDL move behind a port boundary. ADR-007 (Ibis) preserved.

**Constraint inheritance amendment.** ADR-021 adds:
| ADR-021 | Application | QueryEnginePort isolates Dataset model from asyncpg/pg_duckdb mechanics |
```

**This DESIGN does NOT itself modify the brief.** The brief append happens at finalize time per the brief's stated convention ("each feature's DESIGN wave appends a sub-heading"); peer-review-pending features are surfaced in the brief once Atlas approves. Pre-emptive editing would put unratified content in the SSOT.

---

## 3. Cross-cutting helper modules

| Module | Change type | Reason |
|---|---|---|
| `backend/app/repositories/__init__.py` (`RepositoryContainer`) | **EXTEND** — add `query_engine` lazy slot per DWD-3 | Composition root for the new adapter |
| `backend/app/main.py` (lifespan) | **POSSIBLE EXTEND** — add explicit `await repositories.query_engine.probe()` at startup | Earned-Trust composition-root invariant (DWD-6); only required if the lazy-on-first-access pattern doesn't surface probe failure at startup time. DELIVER decides. |
| `backend/app/models/dataset.py` | **DEPRECATE-IN-PLACE** — `query_preview_rows` becomes shim, `_needs_custom_case_macros` renamed public | Migration shim per DWD-5 |
| `backend/app/utils/sql_functions.py` | **NO CHANGE** — read-only dependency of new adapter | `ALL_MACROS` consumed as-is |
| `backend/app/database.py` | **NO CHANGE** — `get_query_engine_pool` consumed as-is | Pool ownership unaffected |
| `backend/app/repositories/lake/_pg_duckdb_query.py` | **NO CHANGE** — read-only reference for the adapter's COPY-route comments | Documents the same Describe-phase mismatch the new adapter handles |

---

## 4. ADR cross-section index addition

When ADR-021 is accepted (post-DELIVER), the `## Cross-section index` table at the bottom of `docs/product/architecture/brief.md` gains a row:

```markdown
| ADR-021 | Application | QueryEnginePort extracted from Dataset |
```

---

## 5. Conflicts with parallel work

| Parallel work | Surface | Conflict status |
|---|---|---|
| Phase 2 dbt-test-validation | `app/use_cases/project/_dbt/`, `tests/integration/dataset_layer/`, `tests/acceptance/dbt-test-validation/` | **No conflict.** Fenced per task brief. |
| Metadata-repository split | `app/repositories/metadata/repository.py` | **No conflict.** This design touches `app/repositories/__init__.py` (the container) but NOT the metadata repository module. The container change is a single new lazy slot — additive, no existing slot reshape. |
| ADR numbering | Both designs mint new ADRs concurrently | **Mitigated** by highest+2 (ADR-021 here, ADR-020 expected for the parallel dispatch). Renumber-by-second-merged precedent applies. |

---

## 6. Out-of-scope (deliberately not changed)

- Macro registry extraction into a long-lived UDF library — this is a Phase 2 carve-out hint in the tech-debt review §6, but coordinating it across the dbt-export `_dbt/macros_sql.py` and the runtime `utils/sql_functions.ALL_MACROS` requires the parallel work to settle first. Scheduled as a future feature, not this one.
- `RepositoryContainer` rename to `AdapterContainer` — captured as forward note in DWD-3, deferred until ≥3 non-repository adapters exist.
- `Dataset.serialize()` cleanup — that method already calls `display_sql` (Ibis) and is unaffected by this design.
- The `query_preview_rows` shim removal — separate later commit/PR per DWD-5.
