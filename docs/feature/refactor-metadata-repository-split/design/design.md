<!-- DES-ENFORCEMENT : exempt -->
# DESIGN — Split `MetadataRepository` into per-aggregate repositories

**Feature slug:** `refactor-metadata-repository-split`
**Author:** Morgan (`nw-solution-architect`), Propose mode
**Date:** 2026-05-10
**Originating signal:** `docs/research/tech-debt-hotspot-review.md` Finding 1 (L3 god-object, 26 commits, 866 LOC, 35+ methods, 8 aggregates)
**Read-only fence:** Phase 2 dbt-test-validation surfaces and the parallel `extract-dataset-query-port` design dispatch (`backend/app/models/dataset.py`) are NOT analyzed or modified.

## §0 Confirmation checklist

| Read | Notes |
|---|---|
| `docs/research/tech-debt-hotspot-review.md` Finding 1 | Trigger; recommends per-aggregate split, effort M, confidence high. |
| `backend/app/repositories/metadata/repository.py` | 866 LOC, 8 aggregates, 35+ methods, one decorator, one helper pair (`_encode_session_cursor` / `_decode_session_cursor`), one batch-build static helper. |
| `backend/app/repositories/__init__.py` | `RepositoryContainer` registers via `partial(MetadataRepository, db)`; `.metadata` is a `@property` shortcut; `with_repositories` injects via kwargs. |
| `backend/app/repositories/metadata/__init__.py` | Records package; `MetadataRepositoryProtocol` already defined and exported. |
| Use cases (sample) — `dataset/create_dataset_from_upload.py`, `session/list_session_events.py`, `sql_access/get_sql_access.py`, `report/*`, `view/*`, `project/*`, `organization/*` | Two access patterns: (a) `metadata_repo = repositories.metadata` then call methods; (b) inline `repositories.metadata.method(...)`. >25 use-case files use one of the two. |
| `backend/tests/repositories/test_*_repository.py` | **Per-aggregate test files already exist** (`test_dataset_repository.py`, `test_project_repository.py`, `test_session_repository.py`, `test_transform_repository.py`, `test_view_repository.py`, `test_report_repository.py`, `test_organization_repository.py`, `test_project_memory_repository.py`, `test_external_access_repository.py`). Aggregate boundaries are already understood by tests; only the production class hasn't caught up. |
| `docs/decisions/` (ADR-013…019) | Nygard format with extended sections (Status, Context, Decision drivers, Considered options, Decision outcome, Consequences, Cross-decision composition, Open questions, References). ADR-020 = next. |
| `docs/product/architecture/brief.md` | Application architecture section is the brief root; this design appends a sub-heading. |
| `CLAUDE.md` | `RepositoryContainer` + `RestrictedSession` + `with_repositories` + `handle_returns` decorator stack is binding. Org-scoping discipline preserved. |

**What shifted from initial framing:** The hotspot review classifies this as effort M with no migration shim required if the container property surface is preserved. The discovery that per-aggregate test files already exist (8 of them) collapses risk further — the *test* boundary already matches the *target* class boundary. This is a textbook latent decomposition: split is mechanical from a test-architecture perspective.

## §1 Problem statement

`MetadataRepository` is an L3 god object. One class persists 8 unrelated aggregates (projects, project memories, sessions, datasets, transforms, organizations, views, reports). Symptoms:

- **Low cohesion**: methods that touch `ProjectRecord` and methods that touch `ReportRecord` share nothing except `self._session`. There is no aggregate-level invariant the class enforces.
- **Test friction**: tests that need to mock the repo for a use case must satisfy an interface 35-method-wide, even when the use case touches one aggregate.
- **Change risk**: 26 commits over the file. Any aggregate change re-tests the whole file's blast radius.
- **Search noise**: 35+ methods on one class produces poor IDE outline-view ergonomics; aggregate operations are visually buried.

It is currently working — no correctness defect, no production risk. The cost is **maintainability and modifiability** (ISO 25010 §7).

## §2 Architectural options

### α — Eight per-aggregate repository classes (one per aggregate)

`ProjectRepository`, `ProjectMemoryRepository`, `SessionRepository`, `DatasetRepository`, `TransformRepository`, `OrganizationRepository`, `ViewRepository`, `ReportRepository`. Each takes `RestrictedSession` via composition. Each is registered with `RepositoryContainer` under its own key (`project_repository`, etc.) AND surfaced as a `@property` on the container. `repositories.metadata` is preserved as a **deprecation-flagged facade** (a thin object exposing the legacy 35-method surface by delegating to the eight new repos) so existing call sites keep working unchanged. The aggregate-specific helpers (`_encode_session_cursor`, `_decode_session_cursor`, `_build_transform_record`) move with their aggregate.

**Pros:** matches the test boundary that already exists; matches DDD aggregate boundary; trivial to mock per use case (one repo per use case in the typical case); each new class is ~80–150 LOC; 1:1 mapping to the existing protocol's section headers.

**Cons:** introduces 8 new classes + 8 new container slots; the legacy facade is an extra moving part during migration.

### β — Three cohesive groups by access correlation

Group by which aggregates are accessed together in use cases:

- **`ProjectGraphRepository`**: project + project_memory + dataset + transform (the bulk of chat-driven workflows touch this graph together).
- **`SessionRepository`**: session + project_memory linkage queries (event replay, dispatch).
- **`ProjectArtifactsRepository`**: organization + view + report (artifact-shaped resources).

**Pros:** fewer classes (3 vs 8); reflects empirical co-access patterns.

**Cons:** the groupings are not stable — `view`/`report` increasingly couple to `dataset` (per ADR-007 ibis SQL generation); future use cases will pull aggregates across the artificial group boundary. β trades L3 god-object for L3 mini-god-objects. Test boundaries already in place don't match the group boundaries — the existing per-aggregate test files would each have to import a 3-aggregate class, re-introducing the wide-mock friction we are trying to remove.

### γ — Mixin-based decomposition (one class, eight mixins)

Keep `MetadataRepository` as the public type; split implementation into `_ProjectMixin`, `_DatasetMixin`, etc., composed into one class via multiple inheritance.

**Pros:** zero call-site change. Smallest diff.

**Cons:** does not actually solve the smell. Method count on the public class is unchanged; tests still see 35 methods on the surface. Mixins muddy `mypy` and `mro` reasoning. Python community consensus: composition > mixins for this exact case. **Rejected as a Trojan horse — looks like a refactor, isn't one.**

## §3 Reuse Analysis

| Component | Status | Notes |
|---|---|---|
| `RestrictedSession` (`backend/app/repositories/__init__.py`) | **REUSE AS-IS** | Each new repo accepts it identically. |
| `RepositoryContainer` (same file) | **EXTEND** | Add 8 new keys + properties; keep `metadata_repository` key bound to the facade for one release cycle. |
| `with_repositories` decorator (same file) | **REUSE AS-IS** | Injection mechanism unchanged. |
| `handle_repository_exceptions` decorator (`metadata/repository.py:42`) | **EXTEND** (move) | Lift to `metadata/_decorators.py` (or `_base.py`); each new repo imports it. |
| `MetadataRepositoryProtocol` (`metadata/__init__.py:20`) | **DEPRECATE** | Replaced by 8 per-aggregate Protocols (`ProjectRepositoryProtocol`, `DatasetRepositoryProtocol`, …). The old Protocol stays for one release as a deprecation alias documenting the migration. |
| `_mappers` module | **REUSE AS-IS** | Per-aggregate functions; each new repo imports the ones it needs. |
| `*Record` ORM classes | **REUSE AS-IS** | No model change. |
| `decode_cursor` / `encode_cursor` (`app/utils/pagination.py`) | **REUSE AS-IS** | Already shared. |
| `validate_condition_sql` (`app/utils/sql_safety.py`) | **REUSE AS-IS** | Used only by transforms; moves with transform repo. |
| `_encode_session_cursor` / `_decode_session_cursor` static helpers | **REUSE** (move) | Move into `SessionRepository` as private staticmethods. |
| `_build_transform_record` static helper | **REUSE** (move) | Move into `TransformRepository` as a private staticmethod. |
| `repositories.metadata` facade | **CREATE NEW** (transitional) | Thin delegating object. Removed once all call sites migrate. |
| Per-aggregate test files (already exist) | **REUSE AS-IS** | Their test cases stay; the conftest swaps `MetadataRepository(db)` for the matching per-aggregate class. |

## §4 Recommendation

**Option α — eight per-aggregate repositories with a transitional `repositories.metadata` facade.**

Rationale, in order of weight:

1. **The aggregate boundary is already empirically validated by the test layout.** Eight per-aggregate test files exist; six of them test exactly the slice the proposed eight classes own. The split is a recognition of an existing structure, not the imposition of a new one.
2. **Test friction relief is the highest-ROI consequence.** A use case that touches one aggregate gets a one-method-mock. Moving from a 35-method `MetadataRepositoryProtocol` to a 5–8-method `DatasetRepositoryProtocol` cuts mock surface area ~4–7x for the typical use case. This compounds across every test file that uses the repo.
3. **The facade neutralizes call-site risk.** All ~25 use-case call sites keep working unchanged for the duration of the migration. The deprecation arc is: (a) ship facade + new classes, (b) migrate use cases per-aggregate (8 small batches, parallelizable), (c) delete facade. Each batch is independently revertable.
4. **β's groupings are unstable; γ doesn't actually fix the smell.** Already analyzed in §2.
5. **DI/IOC compliance is preserved.** Each repo depends on `RestrictedSession` (a port), composed at the container level (composition root). Use cases depend on container properties, not on concrete classes. Hexagonal discipline intact (ADR pattern: ports-and-adapters family).
6. **Conway's check.** Single-team brownfield. No team boundary impacted.
7. **Org-scoping discipline preserved.** Each new repo keeps the existing org-scoping convention call-site-by-call-site (the repos take `org_id` as a parameter where the current methods do; org enforcement stays at the use-case/router boundary, unchanged).

**Effort:** **M** (Medium). One day for the structural split + facade. Two days for incremental call-site migration (8 batches of ~3 sites each). One day for protocol decomposition + test-conftest cleanup. ~4 days estimated.

## §5 Migration / call-site impact

**Phase A — additive (zero call-site change).**

1. Create `backend/app/repositories/metadata/_base.py` housing `handle_repository_exceptions`.
2. Create eight per-aggregate modules: `metadata/project_repository.py`, `metadata/dataset_repository.py`, etc. Each defines its class + its Protocol.
3. Update `metadata/__init__.py` to export the eight new symbols.
4. Update `RepositoryContainer.__init__` to register the 8 new keys (`project_repository`, …) and add 8 `@property` shortcuts (`.projects`, `.datasets`, …). Keep `metadata_repository` key bound to a new `_LegacyMetadataFacade` that delegates each method to the appropriate underlying repo.
5. Run the existing test suite — green by construction (facade preserves the surface).

**Phase B — incremental (one aggregate per batch).**

For each aggregate (8 batches), update its consuming use cases to use the new container property (`repositories.datasets` instead of `repositories.metadata`). Each batch is ~3 files, atomic commit, independently revertable.

**Phase C — terminal (one ADR-amendment commit).**

Once all use cases migrated, delete `_LegacyMetadataFacade`, the `metadata_repository` key, and `MetadataRepositoryProtocol`. Update the ADR to "Accepted — facade removed."

## §6 Quality attributes

| Attribute (ISO 25010) | Effect |
|---|---|
| **Maintainability — modularity** | 866 LOC → 8 files of ~80–150 LOC. One responsibility per file. |
| **Maintainability — testability** | Mock surface per use-case test drops 4–7x. Existing per-aggregate test files have a 1:1 SUT after migration; no test rewrite required, only conftest swap. |
| **Maintainability — analyzability** | IDE outline view + `mypy` errors localize to the touched aggregate. |
| **Maintainability — modifiability** | A change to dataset persistence stops re-running the report tests. |
| **Performance** | No-op. Same SQL, same ORM, same flush semantics. The facade adds one Python attribute lookup per call (sub-microsecond, irrelevant against DB roundtrip). |
| **Reliability** | Unchanged. Transactional boundary stays at router/controller level via `with_repositories`. |
| **Security** | Unchanged. Org-scoping stays at use-case/router boundary; each repo accepts `org_id` parameters identically to today. |
| **Dependency-inversion compliance** | Strengthened. Eight focused Protocols replace one wide Protocol. Use cases can depend on the narrowest interface they need (Interface Segregation, SOLID). |
| **Architectural enforcement** | Adds a `pytest-archon` (already in use per ADR-019) rule: `app.use_cases.*` MUST NOT import `MetadataRepository` or its facade once Phase C lands. Pre-Phase-C the rule warns; post-Phase-C it errors. |

## §7 Risks + mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Facade drift — a use case bypasses container property and imports `MetadataRepository` directly | Low | Medium | `pytest-archon` rule (above). Caught in CI. |
| Migration stalls between phases B and C, leaving facade indefinitely | Medium | Low | Phase B is 8 small batches; ADR-020 lists all 8 as the Phase B exit criterion. The facade carries a `DeprecationWarning` on construction so any future use case author sees the warning at test time. |
| Use case touching multiple aggregates becomes verbose (`repositories.projects`, `repositories.datasets`, `repositories.transforms`) | Low | Low | This is the desired explicitness — each access declares its dependency. The 1–2 use cases that legitimately need 3+ aggregates already fetch them sequentially today. |
| Test-conftest fixtures (`repo_with_project` etc.) need updating | Certain | Low | Mechanical: each fixture's `MetadataRepository(db)` becomes `<Aggregate>Repository(db)`. Done as part of Phase A in the same commit. |
| Concurrent `extract-dataset-query-port` design (parallel dispatch) introduces a new port that touches dataset persistence | Possible | Low | The two designs do not overlap: query-port extracts query *execution* from the model, this design splits the *repository*. The new dataset query port is a port on `Dataset` (model layer), orthogonal to `DatasetRepository` (persistence layer). Cross-reference at handoff. |
| dbt-test-validation Phase 2 in-flight code adds new `metadata_repository` call sites that don't see the new container properties | Low | Low | Phase 2 is read-only-fenced from this design; whatever it adds against the legacy facade keeps working through Phase B. Migration of Phase-2-introduced sites happens in the same batch as the matching aggregate. |

## §8 External integrations

None. This refactor is purely internal repository-layer mechanics — no external API, no SDK, no third-party service. No contract-test annotation needed for the DEVOPS handoff.

## §9 Earned-Trust note

This refactor introduces no new substrate dependency. The probe contract from ADR-019 carries forward unchanged for dbt-test-validation; this design adds nothing new to probe. The architectural enforcement rule (pytest-archon import constraint) is the analog of "wire-then-probe-then-use" for this layer: an attempted import of the deprecated facade post-Phase-C fails at CI, not at the failing use case.
