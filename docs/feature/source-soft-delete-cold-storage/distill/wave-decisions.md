# DISTILL Decisions — source-soft-delete-cold-storage

**Wave:** DISTILL · **Feature:** DC-199 (parent DC-195) · Backend-only.
**Reads:** `discuss/` (user-stories, story-map, journey), `design/` (application-architecture,
wave-decisions, upstream-changes), `docs/decisions/adr-055-*`.

## Prior-wave reading confirmation

+ docs/feature/source-soft-delete-cold-storage/discuss/user-stories.md
+ docs/feature/source-soft-delete-cold-storage/discuss/story-map.md
+ docs/feature/source-soft-delete-cold-storage/discuss/journey-source-cold-storage.feature
+ docs/feature/source-soft-delete-cold-storage/discuss/wave-decisions.md
+ docs/feature/source-soft-delete-cold-storage/design/application-architecture.md
+ docs/feature/source-soft-delete-cold-storage/design/wave-decisions.md
+ docs/feature/source-soft-delete-cold-storage/design/upstream-changes.md
+ docs/decisions/adr-055-patch-soft-delete-source-cold-storage.md
- docs/product/journeys/*.yaml (not found — feature-local journey used instead)
- docs/product/architecture/brief.md (not found — DESIGN application-architecture used for driving ports)
- docs/product/kpi-contracts.yaml (not found — soft gate, proceed)
- docs/feature/source-soft-delete-cold-storage/spike/ (not found — no spike)
- docs/feature/source-soft-delete-cold-storage/devops/ (not found — default matrix, no infra constraints)

## Key decisions

- **[DWD-1] Walking skeleton skipped (brownfield).** Per `story-map.md`, the `sources`
  router, use-case decorator stack, and metadata repository already exist and are green.
  This feature adds one lifecycle field + one PATCH verb to established machinery, mirroring
  the dataset MR-7 cold-storage reference. No `@walking_skeleton` scenario is created.

- **[DWD-2] Test strategy = real I/O (Strategy C).** The only driven port is the metadata
  repository (a real DB). Acceptance and use-case tests exercise it against a real seeded
  SQLite session (the backend `seeded_db` fixture convention, e.g.
  `backend/tests/use_cases/dataset/test_archive_dataset.py`). No costly external dependency,
  so no fakes. Migration up/down verified on SQLite (and Postgres in CI). Adapter-integration
  scenario tagged `@real-io @adapter-integration`.

- **[DWD-3] Cross-org → 403, unknown id → 404.** The acceptance test asserts **403** for
  the cross-org scenario, per ADR-055 §amendment and `design/upstream-changes.md` — the
  platform posture (`_authorize_source` → `authorize_project_access`, `deps.py:88`)
  supersedes the DISCUSS AC1.2 404 assumption. This is a resolved reconciliation, not an
  open contradiction. See `upstream-issues.md`.

- **[DWD-4] Scenario SSOT lives at `tests/acceptance/source-soft-delete-cold-storage/`**
  (`source-cold-storage.feature`). Scenarios are tagged `@slice1`/`@slice2`/`@slice3` and
  carry `@skip` for one-at-a-time delivery; the crafter unskips one per TDD cycle.
  Slice 1's happy path is the anchor scenario the DELIVER regression proves (fails on
  today's tree — no endpoint — and passes after).

- **[DWD-5] Primary RED tests are backend pytest, mirroring the dataset reference.** Because
  this is a backend brownfield slice, the load-bearing RED tests are use-case tests under
  `backend/tests/use_cases/source/test_archive_source.py` and router tests under
  `backend/tests/routers/test_sources.py`, driven at the repository **port**
  (`repositories={'metadata_repository': ...}`) exactly as `test_archive_dataset.py` does.
  The Gherkin `.feature` is the human-readable scenario contract; DELIVER Phase 1 stands up
  the pytest-bdd harness (pyproject + steps, mirroring an existing acceptance suite) or maps
  the scenarios directly onto the backend pytest suite — recorded per phase in the roadmap.

## Wave-decision reconciliation

Checked every DISCUSS decision against DESIGN/ADR-055. One reconciliation (AC1.2 404→403)
was already resolved in DESIGN and is carried forward here — **0 open contradictions**.
Proceeding to scenarios.
