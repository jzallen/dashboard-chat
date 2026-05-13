<!-- DES-ENFORCEMENT : exempt -->
# Wave Decisions — `refactor-metadata-repository-split` — DISTILL

**Feature:** refactor-metadata-repository-split
**Wave:** DISTILL (acceptance test design)
**Date:** 2026-05-10
**Author:** Quinn (nw-acceptance-designer)
**Prior wave:** DESIGN (Proposed 2026-05-10; recommended Option α — eight per-aggregate repositories with transitional `_LegacyMetadataFacade`; ratified as ADR-020 Proposed)

---

## Reconciliation Result

**Reconciliation passed — 0 contradictions.**

DESIGN's `wave-decisions.md` ratified DWD-1..DWD-10 with Option α, the
transitional facade, the 3-phase migration (A→B→C), and the
`pytest-archon` enforcement rule. All ten DESIGN-wave decisions carry
forward into DISTILL unchanged. No back-propagation issues
surfaced — see `upstream-issues.md`.

DISCUSS was intentionally skipped per CLAUDE.md brownfield routing
(refactor with cause known; entry at DESIGN). DEVOPS was empty (no
external integration; DWD-9 in DESIGN's wave-decisions records this).
There are no user stories to trace; the acceptance criteria derive
from ADR-020's behaviour-preservation contract + DESIGN §0 confirmation
checklist.

---

## Decisions

* **[DWD-1] Walking-skeleton strategy: Strategy C-local — real
  SQLAlchemy + in-memory SQLite, no compose stack required.** The
  repository layer's "real adapter" is the `AsyncSession` bound to an
  aiosqlite engine — exactly the engine `backend/tests/conftest.py`
  uses for the existing per-aggregate test files. No `MinIO`, no
  `auth-proxy`, no `query-engine` are touched by this refactor; the
  walking-skeleton scenario does not need them. Auto-detect rationale:
  Iron Rule for refactors is "preserve behaviour against the real
  substrate the production code runs against," and SQLite-via-aiosqlite
  is the substrate `backend/tests/repositories/test_*_repository.py`
  pins behaviour against today. Tagged `@walking_skeleton @real-io`.
  No `@requires_external` markers needed — there is no costly external
  in scope.

* **[DWD-2] Test location: `tests/acceptance/refactor-metadata-repository-split/`
  at repo root, with its own `pyproject.toml`.** Mirrors the canonical
  precedent at `tests/acceptance/{dbt-test-validation,extract-dataset-query-port,log-image-identity-on-startup}/`.
  Owns its own dependency closure (pytest + pytest-bdd + pytest-asyncio
  + sqlalchemy + aiosqlite) so the suite runs in isolation per
  `cd tests/acceptance/refactor-metadata-repository-split && uv run --no-project pytest`.
  The existing `backend/tests/repositories/test_*_repository.py`
  characterization suites STAY — the new acceptance suite is **parallel**
  to them, validating parity through the public container surface only.
  This preserves the existing per-aggregate test coverage without
  duplication.

* **[DWD-3] Driving port = `RepositoryContainer` properties (the new
  `.projects`, `.datasets`, … and the legacy `.metadata` facade).** Per
  the test-design-mandates skill, the driving port is the entry point
  consumers actually use. For this refactor that is the
  `RepositoryContainer` instance that `with_repositories` injects into
  every use case — never a directly-imported `MetadataRepository` or
  `ProjectRepository` constructor. All `@when` step bindings drive
  through `capture.container.<property>` — the new properties AND the
  legacy `.metadata` facade are both first-class entry points during
  the migration. CM-A evidence: `grep -n 'from app.repositories' tests/acceptance/refactor-metadata-repository-split/steps/refactor_steps.py`
  shows zero direct imports of any per-aggregate repository class.

* **[DWD-4] Walking skeleton scope = Project aggregate, full CRUD
  parity.** Justification (see `distill.md` §2):
  - Smallest non-trivial method surface (5 verbs + existence check).
  - `test_project_repository.py::test_cascades_to_datasets` already
    covers FK cascade across aggregates — proves the per-aggregate
    repo participates in the same `RestrictedSession` correctly even
    when the operation crosses aggregate boundaries.
  - Used by 6 use-case files (B6 in ADR-020's Phase B table) — the
    most representative aggregate for the migration mechanism.
  WS scenario asserts: same dict shape, same readability, same update
  persistence, same delete semantics through both new property and
  legacy facade — against the same real SQLite database, in the same
  scenario. If WS goes green, the entire mechanism the refactor
  introduces (per-aggregate class + container property + facade
  delegation) is exercised end-to-end. Walking-skeleton litmus test:
  - **Title describes user goal?** YES — "Project create-read-update-
    delete returns identical results through new repo and legacy
    facade." The "user" here is the backend engineer migrating call
    sites; the goal is "the migration is safe to land."
  - **Given/When describe user actions/context?** YES — "the engineer
    creates a project … through the new projects repository," "the
    engineer creates a project … through the legacy metadata facade."
  - **Then describe user observations?** YES — "both projects carry
    the same observable dictionary shape," "both projects are readable
    through their respective entry points." All assertions on
    return-values from the driving port.
  - **Demo-able to non-technical stakeholder?** YES — "we split the
    repository into smaller pieces; here is proof a project still
    looks identical from the outside before and after." Atlas (any
    backend reviewer) can confirm.
  - **Litmus test:** "If I deleted the real adapter, would this WS
    still pass?" NO — the SQLite engine IS the adapter; without it
    every step errors at fixture-bind time. WS is testing real wiring,
    not InMemory (Mandate 6 / Dim 9d).

* **[DWD-5] Three feature files, 17 total scenarios.** Per the test-
  design-mandates skill (recommended ratio 2-3 WS + 17-18 focused for a
  typical 20-scenario feature), this feature fits 1 WS + 11 milestone-1
  + 5 milestone-2 = **17 scenarios** (slightly under the recommended
  20 because the refactor has only 8 aggregates and one mechanism
  applied uniformly — additional WS scenarios would be redundant).
  Per-file counts:
    - `project-repository-matches-legacy-facade-end-to-end.feature`: 1 scenario (Phase 00).
    - `each-aggregate-repository-preserves-facade-behavior.feature`: 11 scenarios (Phase 01) —
      7-row Scenario Outline (one row per remaining aggregate) + 4
      standalone scenarios (deprecation warning emission, session
      cursor parity, exception translation, FK cascade across
      aggregates).
    - `metadata-repository-facade-removed-without-breaking-callers.feature`: 5 scenarios (Phase 03) —
      grep audit (no legacy imports), AttributeError on `.metadata`,
      KeyError on `metadata_repository` key, archon-rule rejection of
      a synthetic violator, every per-aggregate property reachable.

* **[DWD-6] Scenario Outline parameterises the 7 remaining aggregates
  in milestone-1.** The structural mechanism is identical for each —
  same `__init__(RestrictedSession)`, same `handle_repository_exceptions`
  decorator, same dict-shape contract. Authoring 7 separate scenarios
  with bespoke step copies would be authored-redundancy without proof
  benefit. The Scenario Outline shape pytest-bdd renders as 7 distinct
  test runs with independent fail-localisation, so a Transform
  divergence does not mask a Dataset regression. Per the BDD-methodology
  skill ("Scenario Outlines for Boundary Testing — use outlines for
  boundary conditions and calculation variations; avoid when scenarios
  diverge structurally"), this is on-pattern: the parity contract is
  identical across rows; only the seed shape and method name vary.

* **[DWD-7] Error-path coverage: 9 of 17 scenarios (53%).** Exceeds
  the skill's 40% floor. Counted as "error" anything where the
  observable outcome is a refactor-defect signal (parity divergence,
  deprecation-warning omission, exception-translation regression,
  missing FK cascade, archon-rule failure, attribute/key-error after
  removal):
    - **Happy path (8):** WS Project parity + 7 outline rows in
      milestone-1.
    - **Error / boundary (9):** deprecation warning emission,
      session cursor byte-identity, exception translation, FK
      cascade, M2 grep audit, M2 AttributeError, M2 KeyError, M2
      archon-rule rejection, M2 every-property-reachable invariant.

* **[DWD-8] Default test filter: `-m "not pending"`.** Walking
  skeleton runs by default. Milestone-1 + milestone-2 are tagged
  `@pending` at the Feature level; DELIVER unpends per phase per
  `roadmap.json`'s `scenarios_to_unskip` lists. Mirrors the precedent
  established by every other acceptance suite at `tests/acceptance/`.

* **[DWD-9] Mandate 7 RED scaffolds use `pytest.fail("DISTILL scaffold
  — DELIVER implements: ...")`.** Per CLAUDE.md project conventions,
  this is the standard scaffold marker for DELIVER's outer-loop entry.
  Every step body in `steps/refactor_steps.py` raises pytest.fail with
  a self-documenting "DELIVER implements: ..." message describing the
  exact production-side change required. The conftest's
  `db_engine` and `repository_container` fixtures are also pytest.skip
  scaffolds — DELIVER replaces their bodies in Phase 00. We use
  `pytest.fail` (not `AssertionError("Not yet implemented")`) for
  consistency with the dbt-test-validation and extract-dataset-query-
  port distill conventions; both are valid RED markers per the
  Red-Gate Snapshot, but `pytest.fail` carries cleaner reporter output
  and is what nwave's DES enforcement greps for in this codebase.

* **[DWD-10] Iron Rule fence: backend/tests/repositories/test_*_repository.py
  bodies are NEVER edited.** Per CLAUDE.md "NEVER modify a failing
  test to make it pass." For this refactor specifically: those 8
  per-aggregate test files are the characterization layer (Feathers's
  sense). DELIVER's only allowed edit to them is the `repo*` fixtures
  in `backend/tests/repositories/conftest.py` — a mechanical
  constructor swap (`MetadataRepository(...)` → `<Aggregate>Repository(...)`).
  If a per-aggregate test body fails after the fixture swap, the
  refactor itself is wrong and must be fixed, not the test. This is
  recorded as an explicit exit criterion on Phase 00 + Phase 01 in
  `roadmap.json` (`git diff` of those test files MUST be empty).

---

## Adapter Coverage Table (Mandate 6)

| Adapter | `@real-io @adapter-integration` scenario | Covered by |
|---|---|---|
| `RestrictedSession` (SQLAlchemy 2.0 async wrapper) | YES | walking-skeleton + every milestone-1 outline row + every milestone-1 standalone scenario + every milestone-2 scenario |
| `aiosqlite` (the in-memory SQLite engine) | YES | walking-skeleton + all milestone-1 + milestone-2 scenarios that bind a fresh container |
| `RepositoryContainer` lazy-construction (`partial(Cls, db)` registration) | YES | walking-skeleton (constructs `.projects` + `.metadata`) + milestone-2 "every per-aggregate property reachable" |
| `_LegacyMetadataFacade` deprecation-warning emission | YES | milestone-1 standalone "Legacy facade emits a deprecation warning on construction" |
| `pytest-archon` rule (DWD-7 in DESIGN's wave-decisions) | YES | milestone-2 "Architectural enforcement rule rejects a re-introduced legacy import" |
| Session cursor encoding (`base64-JSON` round-trip helpers) | YES | milestone-1 standalone "Cursor encoding for session pagination is byte-for-byte unchanged" |
| Exception translation (`SQLAlchemyError → MetadataRepositoryError`) | YES | milestone-1 standalone "Exception translation is preserved when the decorator is lifted" |

Zero "NO — MISSING" rows.

**Costly-external pattern:** none in scope. SQLite is the only
substrate; it runs in-process in every test environment (developer
laptop, CI). No `@requires_external` markers needed.

---

## Driving-Port-to-Behaviour Mapping

| Behaviour preserved | Driving port | Observable outcome |
|---|---|---|
| Project CRUD parity (WS) | `RepositoryContainer.projects` + `.metadata` | Same dict shape, same readability, same update persistence, same delete semantics through both entry points |
| 7-aggregate CRUD parity (M1 outline) | `RepositoryContainer.<aggregate>` + `.metadata` | Equal keysets in returned dicts; equal non-generated values; both records re-readable through their entry points |
| Deprecation warning (M1 standalone) | First access to `RepositoryContainer.metadata` | `DeprecationWarning` emitted; message names a new container property |
| Session cursor parity (M1 standalone) | `RepositoryContainer.sessions.list_sessions` + `.metadata.list_sessions` | Identical cursor strings; identical item ordering across paged calls |
| Exception translation (M1 standalone) | `RepositoryContainer.transforms.create_transform` against an FK-violating insert | `MetadataRepositoryError` raised carrying the SQLAlchemy error message |
| FK cascade (M1 standalone) | `RepositoryContainer.projects.delete_project` against a project-with-children | `RepositoryContainer.datasets.dataset_exists(...)` returns False; transform rows gone too |
| Grep audit (M2) | Production source tree under `backend/app/use_cases` | No module imports `MetadataRepository` or `_LegacyMetadataFacade` |
| Facade removal (M2 ×2) | `RepositoryContainer.metadata` / `RepositoryContainer["metadata_repository"]` | `AttributeError` / `KeyError` raised |
| Archon rule (M2) | pytest-archon evaluation against the source tree augmented with a synthetic violator module | Rule fails naming the offender |
| Container reachability (M2) | Each of the 8 per-aggregate properties on a fresh `RepositoryContainer` | Each yields a constructed repository instance bound to the same `RestrictedSession` |

Every "Observable outcome" cell asserts on a return value from the
driving port or an observable user-visible signal (`DeprecationWarning`
text, raised exception type + message). Zero internal-state
assertions, zero `mock.called` assertions, zero file-existence checks
(Dim 7 mechanical checklist passes for every Then step).

---

## Mandate Compliance Evidence

* **CM-A (Hexagonal boundary).** All `@when` step definitions in
  `tests/acceptance/refactor-metadata-repository-split/steps/refactor_steps.py`
  invoke methods on `RepositoryContainer` instances accessed through
  the `repository_container` fixture. Zero direct imports of any
  `<Aggregate>Repository` class, zero direct imports of
  `_LegacyMetadataFacade`. Verified by `grep -n 'from app.repositories' steps/refactor_steps.py`
  at scaffold-creation time — no matches. The only `app.repositories`
  symbol the steps may import (in DELIVER's later phases) is
  `MetadataRepositoryError` for the exception-translation `@then`
  assertion; that is a DOMAIN-LAYER exception type, not an internal
  component, and is whitelisted under the "exception types" exemption
  in the test-design-mandates skill.

* **CM-B (Business language).** Gherkin uses domain terms only:
  "engineer", "project", "organization", "dataset", "transform",
  "session", "view", "report", "memory", "container", "repository",
  "facade", "deprecation warning", "cursor", "foreign-key cascade",
  "architectural rule". Zero technical jargon: no "API", "HTTP",
  "JSON", "POST", "DataFrame", "DuckDB", "SQLAlchemy", "Protocol",
  "decorator", "asyncio" in any `.feature` file. The terms
  "repository" and "facade" are domain terms here because the user
  for this acceptance suite IS the backend engineer; their domain
  vocabulary names these concepts directly. (The dbt-test-validation
  feature also names "probe" and "harness" in its Gherkin under the
  same exception — when the user-as-stakeholder IS a developer, the
  developer's working vocabulary is domain language.)

* **CM-C (User journey completeness).** Walking-skeleton frames a
  complete journey: engineer creates → reads → updates → deletes a
  project, observing parity at each step. Milestone-1 outline rows
  frame mini-journeys per aggregate: seed prerequisites → invoke →
  re-read. Milestone-1 standalone scenarios each frame a complete
  journey (warning emission on first access; cursor parity across two
  pages; exception translation through a flush-failing insert; cascade
  across three aggregates with read-back verification). Milestone-2
  scenarios each frame the post-removal user observation (engineer
  attempts legacy access → sees the named error; archon rule fires →
  surfaces the violator name; container properties reachable →
  every aggregate yields a bound repository).

* **CM-D (Pure function extraction).** This refactor moves a few
  pure helpers (`_encode_session_cursor` / `_decode_session_cursor` →
  `SessionRepository`; `_build_transform_record` → `TransformRepository`)
  per DESIGN's DWD-5. The cursor helpers are pure functions
  (input: `SessionRecord` or `cursor: str`; output: `str` or
  `tuple[str, str]`; no side effects); the transform-record builder
  is pure modulo the `validate_condition_sql` call (which is itself
  pure — string in, raises on invalid, no side effect). They are
  testable directly without fixtures (DELIVER will exercise them via
  the existing `test_session_repository.py` and `test_transform_
  repository.py` characterization tests, which already cover both
  helpers' observable surface). The acceptance-test scenarios
  exercise the helpers indirectly through the public methods that
  call them — appropriate for an acceptance-level concern.

---

## Self-Review Checklist (skill Dimension 9 + Mandate 7)

- [x] WS strategy declared in this file (DWD-1 = Strategy C-local)
- [x] WS scenario tagged `@walking_skeleton @real-io`
- [x] Every driven adapter has at least one `@real-io` scenario (table above)
- [x] All step bindings have RED-ready scaffolds with self-documenting `pytest.fail("DISTILL scaffold — DELIVER implements: ...")` markers
- [x] All scaffold step bodies use `pytest.fail` (not `AssertionError`) per DWD-9 rationale
- [x] At least one scenario exercises the driving port (`RepositoryContainer.<property>`) via its public Python API, not internal helpers (walking-skeleton + every milestone scenario)
- [x] Error/edge case coverage ≥ 40% (DWD-7: 53%)
- [x] BDD imports after `sys.path` manipulation have `# noqa` markers (skill F-003) — see `tests/acceptance/refactor-metadata-repository-split/conftest.py` line 41
- [x] `@when` step glue imports nothing from `app.repositories.metadata` per-aggregate modules — verified by grep on `steps/refactor_steps.py`
- [x] Mandate 1 (CM-A): import listings show zero internal-component imports in steps (only `MetadataRepositoryError` domain exception is whitelisted)
- [x] Mandate 2 (CM-B): grep results show zero technical terms in `.feature` files
- [x] Mandate 3 (CM-C): walking skeleton + focused scenario counts: 1 + 16 = 17 (1 WS + 11 M1 + 5 M2)
- [x] Mandate 4 (CM-D): cursor + transform-record-builder helpers are pure; their relocation is tested via the existing per-aggregate characterization tests; acceptance scenarios exercise through public methods
- [x] Iron Rule honoured: zero edits to `backend/tests/repositories/test_*_repository.py` bodies allowed in any phase (DWD-10 + roadmap exit criteria)

---

## Wave Outputs (file paths)

* `tests/acceptance/refactor-metadata-repository-split/project-repository-matches-legacy-facade-end-to-end.feature` (1 scenario; @walking_skeleton @real-io)
* `tests/acceptance/refactor-metadata-repository-split/each-aggregate-repository-preserves-facade-behavior.feature` (11 scenarios; @aggregate_split @real-io @pending)
* `tests/acceptance/refactor-metadata-repository-split/metadata-repository-facade-removed-without-breaking-callers.feature` (5 scenarios; @facade_removal @pending)
* `tests/acceptance/refactor-metadata-repository-split/conftest.py` (DISTILL scaffold; DELIVER's Phase 00 wires the real engine + container fixtures)
* `tests/acceptance/refactor-metadata-repository-split/pyproject.toml`
* `tests/acceptance/refactor-metadata-repository-split/steps/refactor_steps.py` (DISTILL scaffold; every step body raises `pytest.fail("DISTILL scaffold — DELIVER implements: ...")`)
* `tests/acceptance/refactor-metadata-repository-split/test_project_repository_matches_legacy_facade_end_to_end.py` + `test_each_aggregate_repository_preserves_facade_behavior.py` + `test_metadata_repository_facade_removed_without_breaking_callers.py` (pytest-bdd runners)
* `docs/feature/refactor-metadata-repository-split/distill/wave-decisions.md` (this file)
* `docs/feature/refactor-metadata-repository-split/distill/distill.md` (Quinn's authored notes on the chosen e2e path; companion to the WS feature file)
* `docs/feature/refactor-metadata-repository-split/distill/upstream-issues.md`
* `docs/feature/refactor-metadata-repository-split/distill/roadmap.json`

---

## Hand-off

**Next wave:** `/nw-deliver` (software-crafter) — implements the per-
aggregate repositories + `_LegacyMetadataFacade` + container properties
+ pytest-archon rule via Outside-In TDD, enabling milestone scenarios
one at a time per the 4-phase roadmap. Walking-skeleton MUST go GREEN
first (Phase 00).

**Recipient package for DELIVER:**
* This file (`distill/wave-decisions.md`) — strategy + adapter coverage + mandate compliance
* `distill.md` — notes on the chosen walking-skeleton aggregate (Project) and the e2e path
* `roadmap.json` — 4-phase scenario unskip schedule
* The 3 `.feature` files — scenario SSOT
* The DISTILL scaffolds at the paths listed above — DELIVER replaces the `pytest.fail` step bodies and the `pytest.skip` fixture bodies with real implementations.
* ADR-020 (Proposed) + DESIGN's `wave-decisions.md` DWD-1 through DWD-10 + `c4-diagrams.md` — unchanged, governing.
