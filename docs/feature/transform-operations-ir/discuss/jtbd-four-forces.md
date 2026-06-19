# JTBD Four Forces — transform-operations-ir (JOB-003)

**Wave:** DISCUSS · light JTBD bridge

Forces are extracted from the merged DESIGN evidence (`evaluation.md`,
`adr-051`), not from new interviews. The "current behavior" being displaced is
the de-facto operations log: the `transforms` table ordered by `created_at` with
in-renderer validation.

| Force | Direction | Content (evidence) |
|---|---|---|
| **Push** (frustration with today) | toward the new IR | Order is pinned to `created_at` and breaks on batch-insert timestamp collisions (`dataset_sql.py:104-107`, `repository.py:657-671`). Malformed operations persist and surface later as `-- Error generating SQL` far from the write (`dataset_sql.py:46-50`). Adding an operation means editing three `match` arms in lockstep (`types.py:138-267`). |
| **Pull** (attraction of the new) | toward the new IR | A single canonical, sequenced, tool-agnostic list of operations: deterministic render by construction, validation at the boundary, one catalog entry per operation, and a clean inbound path for Excel→M→operations→ibis→SQL. ibis/SQL always *derived*, never authority. |
| **Anxiety** (concern about adopting) | against | The `sequence` migration is "not as trivial as a column add" (ADR-051 §Consequences/Operational): backfill formula, concurrent-insert safety, deployment ordering, rollback. Risk of breaking existing datasets' staging SQL during the transition. Two new sidecar tables + a `types.py` refactor add surface area. |
| **Habit** (inertia of current behavior) | against | The `created_at`-ordering convention is load-bearing across the loader (`repository.py:619`), the renderer, and the dedup path (`repository.py:609-627`). Every consumer that loads transforms assumes the current shape; `order_by(sequence)` must be threaded everywhere. |

## Force balance & implication for slicing

Push + Pull are strong and concrete (correctness bugs that exist today). The
dominant restraining force is **Anxiety about the migration**, not habit. That
drives the slice ordering decision: **Slice 1 carries the `sequence` migration
first and in isolation**, with a backfill + rollback path and production-data
acceptance, so the riskiest, highest-anxiety change is de-risked before any
dependent work (catalog refactor, sidecars, M parser) builds on it. See
`prioritization.md`.

No opportunity-scoring table is produced here (single job). Outcome scores live
on JOB-003 in `docs/product/jobs.yaml`; the under-served outcomes (O1, O2, O5,
each score ≥14) are the ones the slices target first.
