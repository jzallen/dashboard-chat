<!-- DES-ENFORCEMENT : exempt -->
# DISTILL — Split `MetadataRepository` into per-aggregate repositories

**Feature slug:** `refactor-metadata-repository-split`
**Wave:** DISTILL (acceptance test design)
**Date:** 2026-05-10
**Author:** Quinn (`nw-acceptance-designer`)
**Prior wave:** DESIGN (Proposed; ADR-020 Proposed; recommended Option α with `_LegacyMetadataFacade` shim)
**Inputs:** `design/{design,c4-diagrams,wave-decisions,upstream-changes}.md`, ADR-020, `backend/app/repositories/metadata/repository.py` (866 LOC), `backend/tests/repositories/test_*_repository.py` (8 per-aggregate suites already in place).

---

## §0 What this refactor must NOT change (behavior contract)

The split is a structural refactor. The following observables are **unchanged**:

1. **Public method signatures.** Every public method on `MetadataRepository` (35 methods enumerated in `repository.py`) keeps its name, argument list, return type, and exception contract on the new per-aggregate repo that owns it.
2. **Return-value shape.** Dict shape from `_mappers` — `project_to_dict`, `dataset_to_dict`, `transform_to_dict`, `session_to_dict`, `view_to_dict`, `report_to_dict`, `organization_to_dict`, `memory_to_dict` — is identical pre- and post-split.
3. **Side-effect ordering.** `add → flush → refresh` sequence per write; no commit (transactional boundary stays at router/controller level via `with_repositories`).
4. **Exception translation.** `SQLAlchemyError → MetadataRepositoryError` via the `handle_repository_exceptions` decorator. Decorator behavior preserved when lifted to `metadata/_base.py` (DWD-5).
5. **Cursor encoding.** Project pagination (`encode_cursor` / `decode_cursor` from `app.utils.pagination`) and session composite cursor (`_encode_session_cursor` / `_decode_session_cursor`, base64-JSON `(last_active_at, id)`) emit byte-for-byte identical cursors after the helpers move to `SessionRepository`.
6. **Org-scoping discipline.** Each new repo accepts `org_id` as a parameter where the current methods do; tenancy enforcement remains at the use-case/router boundary (DWD-8).
7. **Container access surface.** Both `repositories.metadata` and `repositories['metadata_repository']` keep working through Phase B via `_LegacyMetadataFacade`.
8. **Error messages and `DeprecationWarning` text.** The facade emits a `DeprecationWarning` once per construction; the message names the new container property a caller should use.

If a behavioral change is observed, it is a refactor defect — not "an improvement."

## §1 The acceptance-test surface — what scenarios prove the refactor is safe

Two driving ports for this refactor:
- **`RepositoryContainer` properties** (`.projects`, `.datasets`, `.transforms`, `.sessions`, `.views`, `.reports`, `.organizations`, `.project_memories`) — the new entry points.
- **`RepositoryContainer.metadata`** (and `['metadata_repository']`) — the legacy facade entry point that consumers keep using through Phase B.

Acceptance scenarios assert **parity**: a representative create/read/update/delete invoked through each new property produces the same observable result as the same call invoked through `repositories.metadata`. Scenarios additionally assert: (a) `_LegacyMetadataFacade` emits `DeprecationWarning` on construction, (b) post-Phase-C the facade is gone and the `metadata_repository` key raises `KeyError`, (c) the `pytest-archon` rule (DWD-7) catches any new `MetadataRepository` import in `app.use_cases.*`.

We do **not** rewrite the existing `backend/tests/repositories/test_*_repository.py` characterization tests in this acceptance suite — those are owned by the backend test pyramid and will be re-pointed to per-aggregate repos via the conftest swap (DWD-5 footnote, DELIVER's mechanical change in Phase A). The acceptance suite **at the feature directory** is a separate thin slice that validates parity through the container's public surface only.

## §2 Walking-skeleton scope

**Aggregate chosen for WS: `Project`.** Justification:

- Smallest non-trivial method surface (5 methods: `list_projects`, `get_project`, `create_project`, `update_project`, `delete_project`, `project_exists` — 6 with the existence check).
- Used by the most representative use cases (`create_project`, `list_projects`, `delete_project` — see DESIGN §5 batch B6, "Project, 6 use-case files").
- Has FK-cascade behavior already covered in `test_project_repository.py::test_cascades_to_datasets` — proves the per-aggregate repo participates in the same SQLAlchemy session correctly even when the operation crosses aggregate boundaries.

**WS scenario** (`walking-skeleton.feature`, one scenario):

> *Customer creates, reads, updates, and deletes a project — the new repo and the legacy facade produce identical results*

Touches: `RepositoryContainer.projects` (new) AND `RepositoryContainer.metadata` (facade) AND a real SQLite database. **Real I/O** via SQLite + `RestrictedSession` — no in-memory doubles. If the WS goes green, it proves: (a) `ProjectRepository` is constructible by the container, (b) it uses the same `RestrictedSession` semantics as before, (c) the facade routes `repositories.metadata.create_project` to `ProjectRepository.create_project` and gets the same dict back, (d) `add → flush → refresh` ordering and `_mappers.project_to_dict` shape are unchanged. That is the entire mechanism the refactor introduces, exercised end-to-end.

Tagged `@walking_skeleton @real-io` (DWD-1 mirrors dbt-test-validation Strategy C convention; for repositories, real-IO is just SQLite — no compose stack required).

## §3 Phase plan

| Phase | Title | Scope | Exit criterion |
|---|---|---|---|
| **00** | Walking skeleton — Project split with parity proof | Implement `ProjectRepository` + `_base.handle_repository_exceptions` move + `RepositoryContainer.projects` property + `_LegacyMetadataFacade` (Project methods only). Existing `backend/tests/repositories/test_project_repository.py` stays green via conftest swap. | WS scenario green; existing repository test suite green. |
| **01** | Split remaining 7 aggregates (one parameterised milestone) | Implement `DatasetRepository`, `TransformRepository`, `SessionRepository`, `ViewRepository`, `ReportRepository`, `OrganizationRepository`, `ProjectMemoryRepository` + register all properties + extend facade to delegate every method. Per-aggregate parity scenario (Scenario Outline) covers all 8 aggregates. | M1 outline scenario green for all aggregates; existing repository test suites green; 8 per-aggregate Protocols defined. |
| **02** | Migrate call sites off the facade (8 batches) | Per ADR-020 §Decision outcome, 8 batches (B1–B8) update use-case files to use new container properties. ~31 use-case files identified by grep. Pytest-archon rule warns if a new use case imports the facade. | All grep call sites use new properties; facade is unused at runtime in `app.use_cases.*`; archon rule warns clean (zero hits). |
| **03** | Remove `_LegacyMetadataFacade` (M2 facade-removal) | Delete facade + `metadata_repository` container key + `repositories.metadata` property + `MetadataRepositoryProtocol` deprecation alias; promote archon rule from warn to error; amend ADR-020 status to Accepted. | M2 scenarios green: (a) `repositories.metadata` raises AttributeError, (b) `repositories['metadata_repository']` raises KeyError, (c) archon rule errors on attempted import. |

**Why one milestone for the remaining 7 aggregates instead of 7 phases:** the structural mechanism is established by Phase 00 (Project). Each remaining aggregate is a pure repetition of that mechanism — same `_base` decorator, same `__init__(RestrictedSession)` shape, same parity contract. Parameterising via Scenario Outline lets the crafter implement aggregates in the order their tests already exist, without forcing 7 separate phases that all pass identical exit criteria. If a single aggregate proves harder than expected (e.g., `Transform` due to `_build_transform_record` helper relocation + `validate_condition_sql` import), the crafter splits that one row out into its own follow-up phase — but defaults to one phase.

## §4 Characterization-test strategy

The 8 existing per-aggregate test files at `backend/tests/repositories/test_*_repository.py` are the **characterization layer** for this refactor. They are well-structured per-aggregate (Quinn confirmed by reading `test_project_repository.py` end-to-end — each test class targets one method group, assertions are on dict shape and observable DB state via re-read).

**Strategy:**

1. **Phase 00 conftest swap (mechanical, DELIVER's Phase A scope):** in `backend/tests/repositories/conftest.py`, the `repo*` fixtures swap `MetadataRepository(RestrictedSession(...))` for `ProjectRepository(RestrictedSession(...))` (and similarly for the seven other aggregate fixtures as their phases land). The test bodies do not change — the `repo` parameter type narrows from "wide-protocol object" to "narrow-protocol object," and methods called are still on the public surface.
2. **Parity tests during migration (transitional):** the existing tests against `MetadataRepository` become **temporary parity tests**. After Phase 00 lands, `MetadataRepository` is the facade; the existing tests drive the facade and prove it routes correctly. Once Phase 02 finishes (no consumers of facade) the parity tests are the last consumers.
3. **Phase 03 deletion:** when the facade is deleted, `test_metadata_exception_handling.py` (33 LOC, 1 file) is the only surviving consumer of `MetadataRepository`. It is migrated to `_base.py`'s `handle_repository_exceptions` decorator directly (target unit-tests the decorator on a stub repo) and renamed to `test_handle_repository_exceptions.py`, OR deleted if its assertions are fully covered by the per-aggregate tests' "raises MetadataRepositoryError on SQLAlchemy error" cases. Crafter judgment in Phase 03.

**Iron Rule honored:** no test rewriting to make a refactor green. Conftest swaps are mechanical fixture-bootstrap changes, not test-body edits. If a per-aggregate test fails after the swap, that is a real refactor defect (the per-aggregate repo's behavior diverged from the legacy class's) and the refactor must be fixed, not the test.

---

**Word count:** ~1170 (cap: 1200).
