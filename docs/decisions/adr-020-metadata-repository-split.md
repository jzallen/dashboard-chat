<!-- DES-ENFORCEMENT : exempt -->
# ADR-020: Split `MetadataRepository` into per-aggregate repositories

**Status:** Proposed
**Date:** 2026-05-10
**Originating wave:** DESIGN (entered directly per CLAUDE.md brownfield routing; refactor with cause known)
**Bead:** TBD (assigned at DELIVER kickoff)
**Companion artifacts:**
- DESIGN proposal: `docs/feature/refactor-metadata-repository-split/design/design.md`
- C4 diagrams: `docs/feature/refactor-metadata-repository-split/design/c4-diagrams.md`
- Wave decisions: `docs/feature/refactor-metadata-repository-split/design/wave-decisions.md`
- Upstream-changes record: `docs/feature/refactor-metadata-repository-split/design/upstream-changes.md`
- Source signal: `docs/research/tech-debt-hotspot-review.md` Finding 1

## Context

`backend/app/repositories/metadata/repository.py` is 866 LOC, defines a single `MetadataRepository` class with 35+ methods, and persists 8 unrelated aggregates (projects, project memories, sessions, datasets, transforms, organizations, views, reports). The hotspot review classifies it as L3 god-object, 26 commits, effort M, confidence high.

Two structural facts make the split low-risk:

1. **Test boundaries already match the proposed class boundaries.** Eight per-aggregate test files exist under `backend/tests/repositories/` (`test_dataset_repository.py`, `test_project_repository.py`, `test_session_repository.py`, `test_transform_repository.py`, `test_view_repository.py`, `test_report_repository.py`, `test_organization_repository.py`, `test_project_memory_repository.py`). The aggregate decomposition is already understood by the test layer; only the production class hasn't caught up.
2. **The container abstraction (`RepositoryContainer`) absorbs the call-site impact.** All consumer code accesses the repo via `repositories.metadata` (a `@property` on the container) or via the `repositories['metadata_repository']` key. A transitional facade preserving that exact surface keeps every existing call site working.

The cost today is maintainability and modifiability (ISO 25010 §7) — not correctness. There is no production-risk pressure; the trigger is L3 hotspot debt and the test-friction multiplier (a 35-method `MetadataRepositoryProtocol` is the mock surface for any use case that touches one aggregate).

## Decision drivers

* **Maintainability — modularity.** 866 LOC → 8 files of ~80–150 LOC, one aggregate per file.
* **Maintainability — testability.** Mock surface per use-case test drops 4–7× by Interface Segregation. Existing per-aggregate test files map 1:1 to the new classes; no test rewrite required.
* **Maintainability — analyzability.** IDE outline view, `mypy` errors, and `git blame` localize to the touched aggregate.
* **Dependency-inversion compliance.** Eight focused `Protocol`s replace one wide one. Consumers depend on the narrowest interface they need.
* **Conway's Law.** Single-team brownfield. No team boundary impacted; no Inverse Conway Maneuver needed.
* **Earned Trust (principle 12).** No new substrate dependency; ADR-019's probe contract carries forward unchanged. The architectural-enforcement rule (`pytest-archon` import constraint) is the layer-appropriate analog of "wire-then-probe-then-use" — a use case that imports the deprecated facade post-Phase-C fails CI, not silently in production.
* **CLAUDE.md constraints honored.** `RepositoryContainer` registration pattern, `RestrictedSession` injection, `with_repositories` decorator stack, and org-scoping discipline are preserved verbatim.

## Considered options

### α — Eight per-aggregate repositories with transitional facade. **Chosen.**

`ProjectRepository`, `ProjectMemoryRepository`, `SessionRepository`, `DatasetRepository`, `TransformRepository`, `OrganizationRepository`, `ViewRepository`, `ReportRepository`. Each takes `RestrictedSession` via composition. Each is registered with `RepositoryContainer` under its own key and surfaced as a `@property`. A `_LegacyMetadataFacade` preserves `repositories.metadata` for one release cycle by delegating each legacy method to the appropriate underlying repo and emitting a `DeprecationWarning` on construction.

**Pros:** matches existing test boundary; matches DDD aggregate boundary; trivial per-use-case mocking; 1:1 mapping to existing protocol section headers; zero call-site change in Phase A; revertable per phase.

**Cons:** introduces 8 new classes + 8 new container slots; the facade is an extra moving part for one release cycle.

### β — Three cohesive groups by access correlation

`ProjectGraphRepository` (project + project_memory + dataset + transform), `SessionRepository` (session + project_memory linkage), `ProjectArtifactsRepository` (organization + view + report). **Rejected.** The groupings are not stable — `view`/`report` increasingly couple to `dataset` (per ADR-007 Ibis materialization); future use cases pull aggregates across the artificial group boundary. β trades L3 god-object for L3 mini-god-objects. Test boundaries already in place don't match the group boundaries.

### γ — Mixin-based decomposition (one class, eight mixins)

Keep `MetadataRepository` as the public type; split implementation into `_ProjectMixin`, `_DatasetMixin`, etc. **Rejected.** Does not actually solve the smell — method count on the public class is unchanged; tests still see 35 methods on the surface. Mixins muddy `mypy` and `mro` reasoning. Looks like a refactor, isn't one.

### δ — Big-bang rewrite (split + migrate all use cases in one PR, no facade)

**Rejected.** ~25 use-case call sites across ~12 commits' worth of changes. High revert cost. Blocks parallel work (e.g., concurrent Phase 2 dbt-test-validation, parallel `extract-dataset-query-port` design). The facade-based incremental migration achieves the same end state with fractional risk.

## Decision outcome

**Option α — eight per-aggregate repositories with transitional facade.**

### Mechanism

**Phase A (additive — single PR, all tests stay green):**

1. Create `backend/app/repositories/metadata/_base.py` housing `handle_repository_exceptions` (lifted from `repository.py`).
2. Create eight per-aggregate modules: `metadata/project_repository.py`, `metadata/project_memory_repository.py`, `metadata/session_repository.py`, `metadata/dataset_repository.py`, `metadata/transform_repository.py`, `metadata/organization_repository.py`, `metadata/view_repository.py`, `metadata/report_repository.py`. Each defines its class plus its narrow `Protocol` (e.g., `ProjectRepositoryProtocol`).
3. Move per-aggregate static helpers to their owning module: `_encode_session_cursor`/`_decode_session_cursor` → `SessionRepository`; `_build_transform_record` → `TransformRepository`.
4. Update `metadata/__init__.py` to export the eight new classes and Protocols. Keep `MetadataRepository` and `MetadataRepositoryProtocol` exported as deprecation aliases pointing at the facade.
5. Update `RepositoryContainer.__init__` to register 8 new keys (`project_repository`, `dataset_repository`, …) and add 8 `@property` shortcuts (`.projects`, `.datasets`, `.transforms`, `.sessions`, `.views`, `.reports`, `.organizations`, `.project_memories`). Keep the `metadata_repository` key bound to a new `_LegacyMetadataFacade` that delegates all 35 methods to the appropriate underlying repo.
6. Update `backend/tests/repositories/conftest.py` so each per-aggregate test file's fixture instantiates the corresponding new class (mechanical replacement).

**Phase B (incremental — 8 batches, parallelizable):**

For each aggregate, update its consuming use cases and the (test) conftest fixtures to use the new container property (`repositories.datasets` instead of `repositories.metadata`). Each batch is ~3 files, atomic commit, independently revertable. Rough batch shape:

| Batch | Aggregate | Use-case files (approx) |
|---|---|---|
| B1 | Organization | 2 |
| B2 | Project Memory | 1 |
| B3 | Session | 3 |
| B4 | View | 5 |
| B5 | Report | 5 |
| B6 | Project | 6 |
| B7 | Dataset | 5 |
| B8 | Transform | 4 |

**Phase C (terminal — single PR):**

1. Delete `_LegacyMetadataFacade`.
2. Delete the `metadata_repository` container key and `repositories.metadata` property.
3. Delete `MetadataRepositoryProtocol` deprecation alias.
4. Promote the `pytest-archon` rule from warn to error.
5. Amend this ADR's Status from **Proposed** → **Accepted**.

### Architectural enforcement

A `pytest-archon` test under `backend/tests/architecture/` declares: `app.use_cases.*` MUST NOT import `MetadataRepository` or `_LegacyMetadataFacade` directly. Pre-Phase-C: warn. Post-Phase-C: error.

`pytest-archon` is the codebase's existing operationalized architectural-enforcement tool (see ADR-019 §"three orthogonal layers"). `import-linter` was investigated for ADR-019 and rejected because its contracts are import-graph only with no API for method-presence enforcement on classes; the warn→error promotion lives entirely in `pytest-archon` here, which is sufficient for the import-graph constraint this rule expresses.

### Org-scoping discipline preserved

Each new repository accepts `org_id` as a parameter where the current methods do; org-tenancy enforcement remains at the use-case/router boundary unchanged. CLAUDE.md auth invariant honored.

## Consequences

### Positive

* **Test friction relief is the highest-ROI consequence.** Mock surface per use-case test drops 4–7×.
* **Aggregate boundary is now first-class in the type system.** Eight `Protocol`s; `mypy` enforces narrow consumption; Interface Segregation realized.
* **Smaller blast radius per change.** Modifying dataset persistence stops re-running report tests.
* **Migration is incremental and revertable per phase.** Phase A is safe to land concurrently with Phase 2 dbt-test-validation; Phase B's 8 batches are independent.
* **Architectural-enforcement rule (`pytest-archon`) prevents regression** — cannot accidentally re-introduce the god-object after Phase C.

### Negative / accepted trade-offs

* **One additional class (`_LegacyMetadataFacade`) lives ~one release cycle.** Mitigated by the `DeprecationWarning` and the explicit Phase C exit criterion in this ADR.
* **8 new container slots.** Surface area grows on `RepositoryContainer`. This is the desired explicitness — each access declares its dependency.
* **No `MetadataRepositoryProtocol` deprecation alias once Phase C lands.** Any out-of-tree consumer (none known) would break. Accepted; in-tree consumers are exhaustively migrated by the Phase B exit criterion.
* **`partial(Cls, db)` registration cost is multiplied by 8 in `RepositoryContainer.__init__`.** Microsecond-level; irrelevant.

### Operational

* No new runtime dependency. No new external integration. No DEVOPS contract-test annotation needed.
* No deployment-topology change. ADR-016 5-service compose stack untouched.
* No database migration; ORM records (`*Record`) are unchanged.

### Earned-Trust note

This refactor introduces no new substrate dependency. ADR-019's probe contract carries forward unchanged for dbt-test-validation. The `pytest-archon` import-constraint rule is the layer-appropriate "wire-then-probe-then-use" — an attempted import of the deprecated facade post-Phase-C fails at CI, not at the failing use case.

## Cross-decision composition (intentional)

* **ADR-020 ↔ ADR-007** — Independent. Ibis SQL-generation is a query-execution concern; this refactor splits the persistence layer. Orthogonal.
* **ADR-020 ↔ ADR-019** — Reuses ADR-019's `pytest-archon` enforcement pattern. The architectural-rule three-layer pattern (subtype/structural/behavioral) is not re-applied here because the constraint is purely import-graph (one layer suffices).
* **ADR-020 ↔ in-flight `extract-dataset-query-port` (parallel design dispatch)** — Independent. The query-port extracts query *execution* from `Dataset` (model layer); this ADR splits *persistence* (repository layer). The two are orthogonal layers; merge order is unconstrained.
* **ADR-020 ↔ in-flight Phase 2 dbt-test-validation** — Read-only fence honored. Phase 2's surface (`backend/app/use_cases/project/_dbt/`, eject/, harness.py, etc.) is not analyzed or modified. New `repositories.metadata` call sites Phase 2 introduces work via the facade; they become Phase B migration candidates without coordination cost.

## Open questions

1. **Phase A bead assignment.** This ADR is Proposed; bead ids assigned at DELIVER kickoff and back-filled here.
2. **Phase B batch ordering on the actual roadmap.** The 8-batch order in the table is a suggested pull-list, not a constraint; software-crafter may reorder by call-site count or by aggregate's coupling to other in-flight work.
3. **Whether `_LegacyMetadataFacade` itself merits a `pytest-archon` rule against direct (non-container) construction.** Probably yes; deferred to Phase A implementer's discretion.

## References

* Source signal: `docs/research/tech-debt-hotspot-review.md` Finding 1
* DESIGN proposal: `docs/feature/refactor-metadata-repository-split/design/design.md`
* C4 diagrams: `docs/feature/refactor-metadata-repository-split/design/c4-diagrams.md`
* Wave decisions: `docs/feature/refactor-metadata-repository-split/design/wave-decisions.md`
* Upstream-changes record: `docs/feature/refactor-metadata-repository-split/design/upstream-changes.md`
* Source file being split: `backend/app/repositories/metadata/repository.py`
* Container: `backend/app/repositories/__init__.py`
* Existing per-aggregate tests: `backend/tests/repositories/test_*_repository.py`
* Architectural-enforcement precedent: ADR-019 §"three orthogonal layers" (`pytest-archon` operationalized)
* Constraint sources: CLAUDE.md (Backend conventions, repository pattern, decorator stack, org scoping)
