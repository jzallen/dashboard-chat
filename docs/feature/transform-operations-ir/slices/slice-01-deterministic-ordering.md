# Slice 01 — Deterministic operation ordering (`sequence`)

**Story:** US-1 · **Sub-job:** SJ-1 · **ADR-051:** D1 / decision 1 · **Effort:** ~1 day (+ pre-slice SPIKE)

## Goal (one sentence)
Give staging operations an explicit, persisted per-dataset order so the rendered SQL is deterministic and reflects the order the author intended — not the row insert clock.

## IN scope
- Add `sequence: int NOT NULL` to the `transforms` table (+ `Transform` domain model, ORM record).
- Backfill existing rows: `ROW_NUMBER() OVER (PARTITION BY dataset_id ORDER BY created_at)`.
- Order loaders by `sequence` (replace `created_at.asc()` at `repository.py:619`; add `order_by` on the ORM relationship `dataset_record.py:106-108`).
- Replace the `created_at` sort in `apply_cleaning_mutations` (`dataset_sql.py:104-107`) with a `sequence` sort.
- Assign `sequence` at write time (gap-tolerant integers).

## OUT scope
- Mid-list reorder UX / fractional indexing (only the assignment formula needs deciding now).
- Any renderer refactor (Slice 03), validation (Slice 02), sidecars, M import.

## Learning hypothesis
**Disproves** that a `sequence` backfill can be applied to existing production datasets **without changing their currently-rendered staging SQL**. If any existing dataset's preview SQL changes after backfill, the current `created_at` order was already ambiguous (the bug we're fixing) — surface and reconcile, don't paper over.
**Confirms** (if it succeeds) that the explicit order is a faithful formalization of today's intended behavior.

## Acceptance criteria
- AC1: After migration, every existing `transforms` row has a non-null `sequence`, unique within its `dataset_id`.
- AC2: For a corpus of existing production datasets, `preview SQL (post-backfill) == preview SQL (pre-backfill)` — **production data, not synthetic** (regressions are reported, not silenced).
- AC3: Swapping two MUTATE operations' `sequence` on one `target_column` via `PATCH /api/datasets/{id}/transforms` changes the rendered SQL (`POST .../preview`).
- AC4: A row inserted concurrently with the backfill receives a non-null `sequence` (never NULL default).

## Dependencies
None (foundation). Blocks 02/03/04/05's reliance on `order_by(sequence)`.

## Pre-slice SPIKE (recommended)
Decide the `sequence` assignment formula: gap-tolerant `ROW_NUMBER() * gap_size` vs fractional indexing. Recommend gap-tolerant integers unless mid-list reorder is frequent (ADR-051 open question 1). Also resolve deploy ordering (loaders must not run against un-backfilled rows) and a rollback path.

## Reference class
Alembic column-add + data backfill with SQLite/PostgreSQL parity (`alembic-migration` skill; org_id-indexing conventions apply). Migrations of this shape exist in `backend/migrations/versions/`.
