# Wave Decisions — transform-operations-ir (DESIGN)

**Wave:** DESIGN · **Scope:** application / component · **Mode:** PROPOSE
**Area:** backend · **Type:** brownfield evaluation (`wave:refactor`)

This file records the decisions taken during the DESIGN wave for the
transform-operations-IR evaluation. Detailed evidence is in
`evaluation.md`; the ratified decision is `docs/decisions/adr-051-operations-as-canonical-transform-ir.md`
(status: Proposed).

## Decisions

| # | Decision | Choice | Rationale (evidence) |
|---|---|---|---|
| D1 | Operations model | **EXTEND** `transforms` table with explicit `sequence: int` column; keep `created_at` for provenance only | The table already is the operations log (`transform_record.py:19-78`); ordering is fragilely `created_at`-derived (`dataset_sql.py:104-107`, `repository.py:619`). A parallel table forks every consumer for no capability gain. |
| D2 | Adapter-args sidecars | **Per-operation, per-target, sparse, internal-only** `operation_ibis_args` / `operation_m_args` (FK + `ON DELETE CASCADE`) | Real render divergences exist (ibis `.strip()` ASCII vs M `Text.Trim`, `types.py:197`; custom case UDFs `types.py:191,206-210`). Transform-level shared args (rejected upstream) couple the two targets and contaminate neutral intent — re-confirmed rejected. |
| D3 | Renderer boundary | **Rules in CODE**: single dispatch catalog + one visitor per target; collapse the triplicated `CleaningExpression` rules | `_validate`/`as_ibis_expr`/`to_display_sql` repeat the same `match` spine three times (`types.py:138-267`). Rules-as-data rejected — a stored translation table is a stored mini-language, forbidden by ADR-026. |
| D4 | Validation alignment | **Validate operation shape at the use-case boundary BEFORE persistence** via a Pydantic discriminated union (mirror `ViewFilterVariant`) | Today validation happens only inside the renderer and failures degrade to `"-- Error generating SQL"` (`dataset_sql.py:46-50`), so malformed operations persist silently. View tier already fixed this pattern (`view.py:154-214`). |
| D5 | Operations scope | **Dataset-staging-scoped**, NOT a shared table across View/Report | Only staging has the non-commutative MUTATE chain that requires `sequence`. View/Report are order-insensitive structured aggregates compiled in one shot (`view.py`, `report.py`, `report_ibis_compiler.py`). Treat as siblings in the ibis-compiler family. |
| D6 | M import surface | **Bounded parser**: only the M subset mapping to the operation vocabulary is importable | Tool-agnosticism requires the IR stay free of any single target's full surface. M joins/pivots/type-engines are out of scope until the vocabulary is explicitly extended. Recorded as a hard constraint in ADR-051. |
| D7 | Parallel-compiler hazard | **No action** — already resolved | ADR-026 MR-5 retired the `model_sql.py` CTE compiler; it now consumes `dataset_sql.build_ibis_table` (`model_sql.py:1-60`). The operations IR feeds DuckDB-preview and dbt-eject through one renderer. |

## Hard invariant (carried into ADR-051)

The compiled ibis expression must always be reproducible from the persisted
operations. ibis/SQL are always derived, never read back, never stored as
source of truth. Stays inside ADR-026's "deterministic in-code compilation; no
stored executable SQL."

## Constraints recorded

- **Bounded M parser** (D6): out-of-vocabulary M is rejected at parse time.
- **Determinism requires `sequence`** (D1): the explicit order column is
  mandatory; `created_at` is insufficient (batch-insert timestamp collisions).

## Reuse gate

PASS. Every proposed element is an EXTEND of an existing component; the only new
artifacts are the two sparse sidecar tables (D2), justified because no existing
structure carries per-target shaping deltas. See `evaluation.md` §2.

## Earned Trust — probes specified (DELIVER-wave deliverables)

1. Renderer-completeness probe (every discriminator handled by every visitor).
2. M ↔ operations round-trip probe (bounded subset stable; out-of-vocabulary
   rejected).
3. Reproducibility probe (operation-list → byte-identical ibis SQL).
4. Substrate-divergence probe (each sidecar's reason-to-exist pinned by a test).

## Open questions for DISTILL / DELIVER

- `sequence` assignment strategy: gap-tolerant integers (multiples of 1000) vs
  fractional indexing, to make "insert operation between two existing ones"
  cheap. Recommend gap-tolerant integers unless reordering frequency is high.
- Whether the M Renderer (outbound operations→M) is in scope now or deferred;
  the inbound bounded parser is the immediate driver. The catalog supports both
  directions, but only the inbound path is required for the Excel→SQL flow.

## Deliverables produced

- `evaluation.md` — Reuse Analysis + three evaluation answers + two
  carried-forward findings, all with `file:line` evidence.
- `c4-component.md` — C4 Component diagram (Mermaid) of the IR + multi-renderer
  topology and the View/Report sibling relationship.
- `docs/decisions/adr-051-operations-as-canonical-transform-ir.md` — draft ADR
  (status: Proposed) composing with ADR-007 and ADR-026.
- `wave-decisions.md` — this file.
