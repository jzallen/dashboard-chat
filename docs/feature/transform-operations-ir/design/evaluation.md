# Transform Operations IR — Architecture Evaluation

**Wave:** DESIGN (application/component scope) · **Mode:** PROPOSE
**Area:** backend · **Type:** brownfield evaluation (`wave:refactor`)
**Status:** evaluation complete; decision captured in ADR-051 (Proposed)

This document evaluates whether a tool-agnostic **list of operations** should
become the canonical, persisted intermediate representation (IR) for model
changes, and how the M (inbound) and ibis (outbound) surfaces join through it.
It produces no implementation code. All claims are backed by `file:line`
evidence read during grounding.

---

## 1. Problem framing

The agreed destination flow:

```
Excel → M (Power Query) → parse → [neutral list of operations] → ibis renderer → ibis → SQL
```

The **list of operations is the source of truth**. ibis and SQL are always
*derived* — never read back, never stored as authority. This stays squarely
inside ADR-026's stance: "deterministic in-code compilation; no stored
executable SQL."

**Hard invariant (carried into ADR-051):** the compiled ibis expression must
always be reproducible from the persisted operations. The operations are the
only durable authority; everything downstream is a pure function of them.

### What exists today (grounded)

The system already has a *de-facto* operations model that is one operation per
row in the `transforms` table:

- `TransformRecord` (`backend/app/repositories/metadata/transform_record.py:19-78`)
  — `transform_type` (`filter | clean | alias | map`), `target_column`,
  `expression_config` (structured JSON), plus a derived `expression_sql`
  display string and a `condition_json`/`condition_sql` pair for filters.
- The domain model `Transform`
  (`backend/app/models/transform.py:17-84`) mirrors this with
  `created_at` documented as "For ordering cleaning transforms"
  (`transform.py:41`).
- The renderer `dataset_sql.build_ibis_table`
  (`backend/app/models/dataset_sql.py:78-98`) applies a fixed three-stage
  pipeline: MUTATE → FILTER → RENAME.
- **Ordering is by `created_at`** —
  `apply_cleaning_mutations` (`dataset_sql.py:101-111`) sorts the clean/map
  transforms by `getattr(t, "created_at", "")`. The repository load
  (`repositories/metadata/repository.py:619`) and the ORM relationship
  (`dataset_record.py:106-108`) carry **no explicit order column**.

So the canonical-IR idea is not greenfield: it is a *refinement and
formalization* of a structure that already drives staging SQL. The evaluation
below treats it as an EXTEND, not a CREATE NEW (see Reuse Analysis, §2).

---

## 2. Reuse Analysis (DESIGN hard gate)

| Existing component | File:line | Overlap with proposed IR | EXTEND vs CREATE NEW | Justification |
|---|---|---|---|---|
| `transforms` table / `TransformRecord` | `transform_record.py:19-78`; migration `001_initial_schema.py:88-106` | Already one-operation-per-row with discriminator + structured config | **EXTEND** | The table *is* the operations log already. Adding an explicit `sequence` column + tightening the discriminator vocabulary is strictly additive; a parallel table would fork the write path, the outbox events (`create_transforms.py:45-60`), and the dbt/query-engine sync, doubling maintenance for zero capability gain. |
| `Transform` domain model | `transform.py:17-84` | Authoritative business object per op | **EXTEND** | Add `sequence: int`; keep the frozen dataclass shape. `created_at` stays for provenance but stops being load-bearing for ordering. |
| `CleaningExpression` (`_validate` / `as_ibis_expr` / `to_display_sql`) | `types.py:120-267` | Triplicated op→target rules (validate, ibis, display SQL) | **EXTEND / collapse** | These three methods are the operation→ibis renderer in embryo, but the rule set is repeated three times over the same `match self.operation` spine. Collapse to a single dispatch catalog (one entry per op carrying its validate + ibis-render + display-render closures). Do NOT create a new renderer from scratch — refactor the existing one into the visitor shape. |
| `QueryBuilderJSON.as_ibis_filter` | `types.py:34-117` | Filter-operation → ibis predicate | **EXTEND** | Already a closed-world `match` over a fixed operator set. It is the filter arm of the same renderer; bring it under the same dispatch discipline as `CleaningExpression`. |
| `dataset_sql.build_ibis_table` + stage helpers | `dataset_sql.py:78-138` | The operation→ibis renderer (driving side) | **EXTEND** | Already the single ibis rendering path for staging. The `sequence`-ordered iteration replaces the `created_at` sort at `dataset_sql.py:104-107`. |
| `model_sql.generate_model_sql` | `model_sql.py:51-60` (+ module docstring) | dbt-staging renderer | **REUSE as-is** | ADR-026 MR-5 already retired the parallel CTE compiler; `model_sql.py` now *consumes* `dataset_sql.build_ibis_table` via `IbisDbtSourceDuckDBCompiler`. No second compiler to reconcile — the operations IR feeds both DuckDB-preview and dbt-eject through one renderer. |
| `ReportIbisCompiler` | `report/report_ibis_compiler.py:1-44` | Report-tier structured→ibis compiler | **REUSE / do not absorb** | Reports compile `columns_metadata` (dimensions/measures) via `group_by().aggregate()`. This is a *different vocabulary* (aggregation, not row/column shaping). It shares the ibis-compiler *family* but not the operation list. Keep separate (see §5, View/Report strategy). |
| `View` model + `ViewFilterVariant` discriminated union | `view.py:51-241` | Structured, validated-at-boundary IR | **REUSE as the pattern to copy** | View already moved validation to the boundary via a Pydantic discriminated union (`view.py:200-214`, `parse_view_filter`). This is exactly the validation-at-boundary fix the operations IR needs (§6, Finding 1). Copy the pattern; do not share the table. |

**Gate result: PASS.** Every proposed element maps to an EXTEND of an existing
component. The only genuinely new artifacts are the two sparse adapter-args
sidecar tables (§4), justified because no existing structure carries
per-target shaping deltas.

---

## 3. Evaluation Question 1 — Operations model

**Question:** Refine the existing one-op-per-row `transforms` table into the
canonical operations table with an explicit `sequence` column, vs. introduce a
new parallel operations table?

### Evidence

- Order today is `created_at`-derived, not explicit:
  `apply_cleaning_mutations` sorts by `created_at`
  (`dataset_sql.py:104-107`); the loader orders by `created_at.asc()`
  (`repository.py:619`); the ORM relationship has **no `order_by`**
  (`dataset_record.py:106-108`).
- `created_at` is a `DateTime` defaulted per-row at insert
  (`transform_record.py:72`). A batch create
  (`create_transforms_batch`, `repository.py:657-671`) inserts all rows in one
  flush — multiple operations can collide on the same timestamp, and the
  intended order is then non-deterministic. The sort key
  `getattr(t, "created_at", "") or ""` (`dataset_sql.py:106`) even tolerates a
  missing timestamp by sorting it first, which silently reorders.
- **Operation order is not commutative.** MUTATE-stage operations compose:
  `trim` then `map_values` ≠ `map_values` then `trim` when a mapping key has
  surrounding whitespace. The current pipeline already iterates clean/map ops
  in sequence and re-`mutate`s the same `target_column`
  (`dataset_sql.py:108-110`), so order is semantically load-bearing **today**,
  yet pinned to a fragile clock.

### Options

| Option | Description | Trade-offs |
|---|---|---|
| **1A — Extend `transforms` with `sequence` (RECOMMENDED)** | Add a non-null `sequence: int` column; order the load + the renderer by `sequence`; keep `created_at` for provenance only. | + Single write path, single outbox event, single sync. + Determinism by construction. + Smallest migration (one column + backfill `ROW_NUMBER() OVER (PARTITION BY dataset_id ORDER BY created_at)`). − Requires a backfill and an `order_by(sequence)` everywhere transforms load. − `sequence` must be assigned at write time (gap-tolerant integer or fractional indexing for cheap reordering). |
| **1B — New parallel `operations` table** | Greenfield table; migrate `transforms` rows into it; dual-write or cut over. | + Clean vocabulary, no legacy columns (`condition_sql`, `expression_sql`). − Forks every consumer: outbox events, dbt sync, query-engine sync, the `find_transform_by_sql` dedup path (`repository.py:609-627`). − Migration risk; two sources of truth during transition violates the hard invariant. − No new *capability* — pure rename tax. |
| **1C — Keep `created_at`, document the convention** | Status quo + a comment. | + Zero migration. − Leaves the determinism hole open; batch-insert timestamp collisions remain. − Violates ADR-051's ordering constraint. Rejected. |

### Recommendation

**Option 1A.** The `transforms` table is already the operations log; it needs an
explicit total order, not a replacement. Add `sequence: int NOT NULL`, set
`order_by(TransformRecord.sequence)` on load, and replace the `created_at` sort
at `dataset_sql.py:104-107` with a `sequence` sort. Backfill existing rows via
`ROW_NUMBER()` partitioned by `dataset_id` ordered by `created_at`. The
`sequence` scope is **per dataset** (the partition key), matching the staging
scope (see §5). Use gap-tolerant integers (e.g. multiples of 1000) or fractional
indexing so a future "insert operation between two existing ones" reorder does
not rewrite the whole list.

> Note: filter and alias operations are commutative *within their stage* (WHERE
> conjunction; RENAME map), so `sequence` is strictly required only for the
> MUTATE arm — but assigning it to **every** operation keeps the IR uniform and
> lets a future cross-stage reordering (if the three-stage split is ever
> relaxed) remain well-defined. Assign to all; enforce in MUTATE.

---

## 4. Evaluation Question 2 — Adapter-args sidecars

**Question:** Are internal-only, sparse `operation_ibis_args` / `operation_m_args`
sidecar tables (FK'd per operation row, holding only per-instance shaping deltas
a target needs that are not part of customer intent) the right scope — vs. the
originally-proposed transform-level ibis-args table?

### Evidence: where target semantics actually diverge

- ibis `trim` renders as `col.strip()` (`types.py:197`). DuckDB's `strip()` and
  Power Query's `Text.Trim` do **not** agree on what counts as whitespace:
  `.strip()` trims ASCII/Unicode whitespace per the engine's definition; M's
  `Text.Trim` trims a specific whitespace set and can take an explicit
  character list. This is a real per-operation rendering delta that is **not
  customer intent** — the customer said "trim", not "trim ASCII-only".
- `case` mode `title`/`snake`/`kebab` route through custom DuckDB UDFs
  (`title_case`, `snake_case`, `kebab_case`, `types.py:191,206-210`). M has no
  identical builtins; a faithful M render needs a per-instance shaping note.
- These deltas are **sparse**: most operations render identically on both
  targets and need **no** sidecar row at all.

### Options

| Option | Description | Trade-offs |
|---|---|---|
| **2A — Per-operation sparse sidecars (RECOMMENDED)** | `operation_ibis_args(operation_id FK, args JSON)` and `operation_m_args(operation_id FK, args JSON)`, each row optional, populated only when a target's render diverges from the neutral operation. Internal-only, never customer-facing. | + Co-located with the operation it shapes; FK cascade-deletes with the operation. + Sparse: zero rows for the common case. + Each target's deltas evolve independently without touching the neutral op. − Two more tables. − Renderers must left-join the sidecar (nullable). |
| **2B — Transform-level ibis-args column/table (REJECTED upstream)** | A single args blob keyed at the transform level, shared across targets. | − Couples ibis and M concerns into one structure: an M-only delta pollutes the ibis render path and vice-versa. − Already rejected as too coupled; re-confirmed here. The neutral operation must stay free of any single target's vocabulary. |
| **2C — No sidecars; encode deltas in the operation config** | Push the shaping delta into `expression_config`. | − Pollutes the *canonical* IR with target-specific knowledge, breaking tool-agnosticism: the operation would carry "ibis says ASCII-only", which is exactly the leak the IR exists to prevent. − The persisted operation would no longer be a pure statement of customer intent. Rejected. |

### Recommendation

**Option 2A — confirm the per-operation sparse sidecar scope.** The originally
proposed transform-level args table is correctly rejected: it couples the two
targets and contaminates the neutral operation. The sidecars must be:

1. **Per-operation** (FK to the operation row, `ON DELETE CASCADE`).
2. **Per-target** (one table for ibis deltas, one for M deltas — never a shared
   blob).
3. **Sparse** (a row exists *only* when that target's render diverges from the
   neutral operation; absence means "render the neutral op faithfully").
4. **Internal-only** (never serialized to the customer; never part of the
   `Transform.serialize()` HTTP surface at `transform.py:71-84`).

The decision rule for "does this belong in the operation or in a sidecar?" is:
**if removing it would change what the customer asked for, it is intent → it
belongs in the operation. If removing it would only change how faithfully a
specific target reproduces that intent, it is a shaping delta → it belongs in
that target's sidecar.**

---

## 5. Evaluation Question 3 — Renderer boundary

**Question:** Should operation→ibis and operation→M translation rules stay in
CODE as one visitor/renderer per target, dispatching on the operation
discriminator — and should the today-triplicated rules in `CleaningExpression`
collapse to a single dispatch catalog? Confirm rules-as-data is rejected.

### Evidence: the rules are triplicated today

`CleaningExpression` (`types.py:120-267`) walks the **same** `match
self.operation` spine three times:

- `_validate` (`types.py:138-166`) — per-op required-field checks.
- `as_ibis_expr` (`types.py:179-223`) — per-op ibis render.
- `to_display_sql` (`types.py:225-267`) — per-op display-SQL render.

Adding a new operation means editing three methods in lockstep; drift between
them is a latent bug (e.g. `_validate` accepts `case` mode `snake` but a future
target renderer might forget it). This is the classic "shotgun surgery" smell
that a dispatch catalog removes.

### Options

| Option | Description | Trade-offs |
|---|---|---|
| **3A — Single dispatch catalog, one renderer per target (RECOMMENDED)** | One catalog keyed by the operation discriminator; each entry carries the op's validate + ibis-render + (display)-render + M-render as cohesive, co-located rules. Each *target* (ibis, M, display) is a visitor that dispatches on the discriminator. | + One place to add an operation; the three arms stay in sync by construction. + New target (M) = new visitor, no change to existing ones. + Enforceable: a static check can assert every discriminator has an entry in every visitor (the "probe" for renderer completeness — see §7). − Refactor of `types.py` ~120-267 (collapse the three `match` blocks). |
| **3B — Keep three separate methods** | Status quo. | − Triplication persists; drift risk grows with every new op and the new M target. Rejected. |
| **3C — Rules as data / translation tables (REJECTED)** | Store the operation→ibis/M translation logic in DB tables or a config DSL. | − Storing executable translation logic reintroduces a stored mini-language / interpreter — precisely what ADR-026 forbids ("no stored executable SQL", "the free-text field gives the compiler something to be afraid of"). − A data-driven rule table is a stored program; the IR's whole point is that *operations* are data and *rendering* is code. Rejected, confirmed. |

### Recommendation

**Option 3A.** Collapse the triplicated `CleaningExpression` rules into a single
dispatch catalog and express each target as a visitor over the operation
discriminator. The **operations are data; the translation rules are code** — a
non-negotiable boundary inherited from ADR-026. M-import (inbound) is the
inverse visitor: a bounded parser that recognizes the M subset mapping to the
operation vocabulary and emits neutral operations. Anything outside the
vocabulary (M joins, pivots, type engines) is **not importable** until the
vocabulary is explicitly extended (a constraint recorded in ADR-051).

The renderer-completeness invariant (every discriminator handled by every
visitor) is itself a probe (Earned Trust, §7): a renderer that silently skips an
operation is a lie about the IR's reproducibility guarantee.

---

## 6. Carried-forward findings

### Finding 1 — Validation misalignment (validate at the boundary, not at compile time)

**Evidence.** `expression_config` shape is validated only when
`CleaningExpression(...)` is constructed *inside the renderer*
(`dataset_sql.py:109`, `:132`), and `build_staging_sql` swallows any failure
into a `"-- Error generating SQL: {e}"` comment
(`dataset_sql.py:46-50`, mirrored at `:57-59`). A malformed operation is
therefore **persisted successfully** (the write path in
`create_transforms.py:37-45` calls `CleaningExpression(...)` only to derive a
display string, and `create_transforms_batch` at `repository.py:657-671` does no
shape validation), then silently degrades to a comment at compile time. The
failure surfaces as broken SQL, far from the offending write.

**Contrast — the View tier already fixed this.** `ViewFilter` became a Pydantic
discriminated union (`view.py:154-214`) so "malformed operators are rejected
before the compiler is reached" (`view.py:79-82`). The operations IR should
adopt the same posture.

**Recommendation.** Move operation-shape validation to the **application /
use-case boundary**, before persistence. Introduce a Pydantic discriminated
union over the operation discriminator (mirroring `ViewFilterVariant`) and
validate in `create_transforms` / `update_transforms` **before**
`create_transforms_batch` writes. Malformed operations are rejected with a
structured error at the API boundary, never persisted, never silently degraded.
The `-- Error generating SQL` fallback at `dataset_sql.py:46-50,57-59` then
becomes a true invariant guard (it should be unreachable for validated
operations) rather than the de-facto validation layer it is today. This is the
Earned Trust posture: the IR refuses to persist an operation it cannot render.

### Finding 2 — View/Report strategy (scope of the operations model)

**Evidence.** View (`view.py`) and Report (`report.py`) each have their own
table and their own structured-JSON IR columns (View: `columns`, `joins`,
`filters`, `grain`; Report: `columns_metadata`). They are unified **only** by
sharing the ibis-compiler *family* — `ViewIbisCompiler` (ADR-026 MR-1) and
`ReportIbisCompiler` (`report_ibis_compiler.py`, MR-3). The report loader orders
by `created_at.desc()` (`repository.py:1111`) and the view loader likewise
(`repository.py:1024`) — neither is an *ordered operation list*; they are
*structured aggregates* compiled in one shot.

**Determination.** The operations model is **Dataset-staging-scoped**, not a
single shared table across all three tiers. Reasons:

1. **Different vocabularies.** Staging operations are row/column *shaping* steps
   (trim, case, fill_null, map_values, filter, alias) whose **order matters**.
   View is *relational composition* (select/join/filter/grain) and Report is
   *aggregation* (group_by/aggregate) — both order-insensitive within their
   structure and naturally expressed as sets, not sequences.
2. **Different cardinality of the ordering invariant.** Only staging has the
   non-commutative MUTATE chain that *requires* `sequence`. Forcing View/Report
   into a sequenced operation list would impose an ordering concept they do not
   have.
3. **They already share the durable property that matters.** All three are
   structured IR compiled deterministically by an ibis renderer with no stored
   executable SQL (ADR-026). The operations IR generalizes *that pattern* to a
   sequenced list for staging; it does not need to physically merge the tables.

**Recommendation.** Scope the operations IR to the Dataset staging tier. Treat
View and Report as **sibling structured IRs in the same family** (same
"operations-as-data, rendering-as-code, ibis-derived, no-stored-SQL"
discipline), not as rows in a shared operations table. If a future requirement
needs cross-tier operation sequencing, that is a new decision — do not pre-merge
on speculation (ADR-051 records this as a non-goal).

---

## 7. Earned Trust — probes the design must specify

Per the architect's Earned Trust principle, every dependency the renderer
relies on must demonstrate it can honor its contract. For this IR the
dependencies that can *lie* are: the operation vocabulary's completeness, the M
parser's bounded subset, and the two render targets agreeing with the neutral
intent.

1. **Renderer-completeness probe.** A static (AST / catalog-membership) check
   that asserts **every** operation discriminator has an entry in **every**
   visitor (ibis, display, and the new M renderer). A visitor that silently
   skips an operation breaks the "ibis is always reproducible from operations"
   invariant. This is the §5 dispatch-catalog enforcement made executable.
2. **Round-trip probe (M ↔ operations).** For the bounded M subset, parsing an
   M fragment to operations and rendering those operations back to M must be
   stable on the supported vocabulary; M outside the vocabulary must be
   *rejected at parse time*, not silently dropped (the bounded-parser
   constraint).
3. **Reproducibility probe.** Given a persisted operation list, recompiling must
   yield byte-identical ibis SQL across runs (determinism by construction). The
   existing dbt-staging row-equivalence tests (`model_sql.py` docstring,
   lines 20-24) are the precedent; extend them to assert *operation-list →
   SQL* determinism.
4. **Substrate-divergence probe (sidecars).** Where a sidecar exists because a
   target lies about a neutral op (ibis `.strip()` ASCII-only vs M
   `Text.Trim`), a test must exercise the *specific* divergence so the sidecar's
   reason for existing is pinned, not assumed.

These probes are first-class deliverables for the DELIVER wave, not
afterthoughts. The validation-at-boundary fix (Finding 1) is itself the
write-path probe: the system refuses to persist an operation it cannot render.
