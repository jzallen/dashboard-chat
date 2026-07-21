# DESIGN Decisions — source-soft-delete-cold-storage

## Key Decisions
- **[D1]** `PATCH /api/sources/{id}` `{"archived": bool}` = soft-delete (Cold Storage); `DELETE` reserved for future hard delete (DC-139). Restore is the symmetric PATCH — no `/restore`. Ratified in **ADR-055 (a)**. (Supersedes the dataset `POST /archive` verb for new resources; datasets grandfathered.)
- **[D2]** Reuse the dataset persistence — nullable `archived_at` + `retention_until` on `sources`; no `deleted_at`. Exposed in the source read contract; list default-excludes archived. ADR-055 (b).
- **[D3]** One boolean-driven use case `archive_source(source_id, *, archived)` on the `@handle_returns`/`@with_repositories` stack, writing through a new `MetadataRepository.update_source(**kwargs)` setter. ADR-055 (c).
- **[D4]** `archive_source` **preserves** the original `archived_at` on re-archive (sets only when `archived_at IS NULL`) — a deliberate improvement over `archive_dataset` (which overwrites), satisfying DISCUSS AC1.4 idempotency. ADR-055 (c).
- **[D5]** Reuse `_authorize_source`: **404** unknown id, **403** cross-org — reconciling DISCUSS AC1.2's 404 to the platform posture (`deps.py:88`). See `upstream-changes.md`.
- **[D6]** Migration `021_add_source_cold_storage` chains off the current head **`020_add_dataset_model_name`** (not 019).

## Architecture Summary
- Pattern: modular monolith, hexagonal (HTTP route → controller → use case → repository port). No new component boundary — extends the existing Source slice.
- Paradigm: OOP (existing backend convention; unchanged).
- Key components: `sources` router (+PATCH, +`archived` list filter), `SourceController.patch_source_archived`, `archive_source` use case, `MetadataRepository.update_source` + `list_sources(archived)`, `source_to_dict`/`Source` field exposure, migration 021.

## Reuse Analysis
See the full table in `application-architecture.md`. Summary: 6 EXTEND, 2 CREATE NEW (use case + migration — per-aggregate mirrors of the dataset MR-7 machinery; literal sharing blocked until the deferred `ColdStorable` mixin extraction). Zero unjustified CREATE NEW.

## Technology Stack
- FastAPI + SQLAlchemy async + Alembic — unchanged; no new dependency. `returns.Result` via the decorator stack.

## Constraints Established
- Idempotent archive (clock-preserving) + idempotent restore.
- Org-scoped transitively via `project_id` (no `org_id` column/index on `sources`).
- Portable migration (plain `add_column`, no index), SQLite + Postgres.

## Upstream Changes
- AC1.2 status code corrected 404 → 403 for cross-org (unknown id stays 404). Full rationale in `upstream-changes.md`.

## Tech-debt flagged (not actioned)
- 2nd instance of the Cold-Storage pattern → `RETENTION_WINDOW` + archive/restore/filter now duplicated across dataset and source paths. Candidate for a future `/nw-refactor` to extract a shared `ColdStorable` mixin + single retention constant. ADR-055 Consequences.

## Handoff
→ DISTILL (`/nw-distill`): author the regression/acceptance tests from `discuss/journey-source-cold-storage.feature` (with the 403 correction), then DELIVER (Outside-In TDD). Backend-only; `backend-use-case` + `alembic-migration` skills.
