# ADR-052: Normalize View/Report Operations into a Shared Relation IR

**Status:** Proposed
**Originating wave:** DESIGN (application/component scope; brownfield evaluation)
**Companion artifacts:**
- Evaluation: `docs/feature/normalize-view-report-operations/design/evaluation.md`
- C4 diagrams: `docs/feature/normalize-view-report-operations/design/c4-component.md`
- Wave decisions: `docs/feature/normalize-view-report-operations/design/wave-decisions.md`
- Domain pass (settled aggregate boundary, not re-litigated here):
  `docs/feature/normalize-view-report-operations/design/domain-model.md`
- Composes with: `docs/decisions/adr-051-operations-as-canonical-transform-ir.md`,
  `docs/decisions/adr-026-ibis-as-only-sql-compiler.md`,
  `docs/decisions/adr-007-ibis-for-sql-generation.md`

> **Scope (this phase): the View and Report tiers only.** ADR-051 deferred these
> tiers explicitly (its decision 6 + non-goals). This ADR takes them up. It
> normalizes the View/Report *embedded-JSON component arrays* into first-class
> rows and binds both aggregates to one typed value-object kernel; it does NOT
> fold them into the Dataset-staging `transforms` table — ADR-051 Finding 2's
> operative decision stands. The Dataset-staging tier is unchanged here.

## Context

The domain pass settled the aggregate question (Option B): **View and Report are
two distinct aggregate roots sharing a typed "Derived Relation" value-object
kernel** — `ProjectionColumn` + `ColumnRole`, `SourceRef`, `Filter`, `Grain`,
and a shared composition service. A Report is a View plus one structural
operator (aggregate-over-grain); its "slightly different business rules"
(`report_type` fact/dimension, measure-requires-grain, no-mart-to-mart) are
Report-aggregate invariants + application-layer policy on the shared kernel.

This ADR decides the **persistence + IR** that realizes that kernel. Today both
aggregates store their components as embedded-JSON arrays on a single entity row:
`columns` / `joins` / `filters` / `grain` on `views`
(`backend/app/repositories/metadata/view_record.py:43-46`) and `columns_metadata`
on `reports` (`backend/app/repositories/metadata/report_record.py:45`). View
re-hydrates its arrays into typed value objects on read (`view.py:300-340`);
Report's `columns_metadata: list[dict]` is never typed — it is hand-validated by
a free function over raw dicts (`column_validation.py:26-50`) and consumed as raw
dicts by the compiler (`report_ibis_compiler.py:105-116`).

The user's ask: a "more flat structure that makes the intermediate
representation easy to map to desired input and output forms." Concretely:
disaggregate the JSON arrays into normalized rows so the IR maps cleanly onto
inbound forms (M / Power Query parser, agent `addFilter`/`addColumn` tools) and
outbound forms (ibis → SQL), and lift Report's dict-soup onto the same typed
kernel View already has.

Three problems motivate the decision:

1. **The component arrays are opaque and non-queryable.** "Which relations filter
   on column X?" or "which reports aggregate measure Y?" cannot be a SQL query
   against a JSON blob. The agent write path must read → mutate-in-memory →
   rewrite a whole array to add a single filter.
2. **Report's projection is untyped dict-soup.** `columns_metadata: list[dict]`
   validated by a hand-rolled function (`column_validation.py`) is the modeling
   debt the domain pass diagnosed (domain-model §2.5); the renderer can be
   reached with malformed metadata.
3. **The kernel-render steps are duplicated across two compilers.** Both
   `ViewIbisCompiler` and `ReportIbisCompiler` build the per-source ibis table,
   map display→ibis types, and project columns
   (`sql_generator.py:226-256` ≈ `report_ibis_compiler.py:102-116`); a kernel
   change means editing both — the triplication smell ADR-051 decision 4 removed
   for staging, present here in duplicate.

## Decision drivers

- **Operations are data; rendering is code; SQL is always derived.** Inherited
  hard invariant from ADR-026 / ADR-051. The compiled ibis expression must
  always be reproducible from the persisted component rows. Nothing reads back
  compiled SQL or a compiled ibis expression as authority.
- **The schema must express the shared kernel.** The domain pass spent its
  argument removing the View/Report duplication; the persistence design must not
  re-duplicate it in the table layout.
- **Order is data only where the compiler honors it.** ADR-051's `sequence`
  discipline applies, but per-component-type: View/Report are declarative
  one-shot relations, not a non-commutative cross-operation MUTATE chain.
- **Brownfield economy.** EXTEND View's existing typed value objects and the
  already-shared `DependencyService`; do not fork parallel structures.

## Decision

### 1. Normalized component tables, shared across both aggregates by parent discriminator

Replace the embedded-JSON arrays with one physical table per **kernel component
type**, each carrying `(parent_type, parent_id)` (`parent_type ∈ {view, report}`)
plus `org_id` and `project_id`:

| Table | Holds | Kernel VO | Parent |
|---|---|---|---|
| `relation_columns` | one projected output column | `ProjectionColumn` | view or report |
| `relation_filters` | one boundary-validated predicate | `Filter` | view or report |
| `relation_joins` | one declared join | `Join` | view (report when it gains joins) |
| `relation_grain` | grain dimensions/time | `Grain` | view or report |
| `relation_aggregations` | one measure→aggregation binding | `Measure` | **report only** |

The shared tables are the schema-level expression of the kernel; the
report-only `relation_aggregations` table is the **additive structure** that
realizes "a Report is a View plus one operator." Parallel per-aggregate tables
(`view_columns` + `report_columns` + …) are rejected — they re-duplicate the
kernel in the schema. Keeping embedded JSON is rejected — it does not deliver the
flat, queryable IR the user asked for. The discriminator is `parent_type` (names
the FK target), **not** `kind` (which would imply the Option-A god-aggregate the
domain pass rejected). `source_refs` stays as the existing JSON column this
phase (normalizing it is a separable follow-on — Open question 1).

### 2. The flat IR carries `sequence` only on joins

The IR is the set of normalized component rows keyed by
`(parent_type, parent_id)`, plus the typed value objects that validate them at
the boundary. Ordering is per-component-type:

- `relation_joins.sequence: int NOT NULL` (scoped per parent) — joins are
  declaration-ordered; the compiler chains them in list order
  (`sql_generator.py:237-241`).
- `relation_columns.position: int NULL` — presentation hint only, never a
  correctness input.
- `relation_filters` (WHERE conjunction), `relation_grain` (GROUP BY key set),
  `relation_aggregations` (independent aggregates) — **no order column**;
  commutative/set-like.

A global `sequence` on every component row (mirroring staging verbatim) is
rejected: it would assign correctness-bearing order to components that have none,
and a global sequence across different component tables is meaningless (a join
and a filter do not interleave). This is the precise reconciliation with ADR-051:
both IRs make "order is data" true, but each carries order only where its
compiler is order-sensitive — staging needs a per-dataset `sequence` on a
non-commutative MUTATE chain; View/Report need a per-parent `sequence` on joins
only.

### 3. Validation at the application boundary; Report columns promoted to the typed kernel

Report's `columns_metadata` is promoted to Pydantic discriminated unions over
`semantic_role`, mirroring `ViewFilterVariant`'s union over `operator`
(`view.py:154-214`) exactly as ADR-051 decision 5. `ViewColumn` becomes the
shared `ProjectionColumn` (role enum generalized to cover Report's
entity/dimension/measure, collapsing the `GrainRole.Metric` ≅ `measure` drift);
a `MeasureColumn`/`Measure` variant carries the bound aggregation function. The
hand-rolled `validate_columns_metadata` (`column_validation.py:26-50`) retires —
its role/type-pair table becomes per-variant `Literal` typing rejected at the
boundary before the renderer is reachable.

Report-only rules stay at the application boundary, exactly per the domain pass
(domain-model §2.4): `report_type` is a typed attribute on the Report aggregate;
`ReportRequiresDimension` (`create_report.py:128-131`) stays a use-case check
(now expressible over typed rows, not dict probes); `InvalidReportReference`
(no-mart-to-mart, `create_report.py:109-110`) promotes to a first-class method on
the shared composition service, peer to View's circular-dependency arm.

### 4. Renderer boundary: one kernel visitor, the report extension composes it

Collapse the two compilers' shared steps into a single **kernel visitor** that
renders the shared components (sources → join-by-sequence → filter → project)
into an `ibis.Table`; the **report extension** composes the kernel visitor's
output and applies the one additional operator
(`group_by(grain).aggregate(measures)`). Each render target (ibis-executable,
ibis-display, future M-outbound) is a visitor keyed on the component
discriminator (ADR-051 decision 4 verbatim). The entity-only report branch
(`report_ibis_compiler.py:108-113`) becomes "the kernel visitor's output with no
aggregation step," not a special case.

A mode branch inside one merged compiler (`if parent_type == report:`) is
rejected — it re-couples the lifecycles the domain pass kept distinct;
composition (extension calls kernel visitor) keeps them composable without a
mode flag. **Rules-as-data stays rejected** (ADR-026, ADR-051 decision 4): the
catalog is code keyed by discriminator, never a stored translation table.

### 5. Migration shape: expand/contract, joins backfilled by array position

Create the five component tables (`org_id`/`project_id` indexed; composite
`(org_id, parent_type, parent_id)` index per table; `relation_joins` also
indexes `(parent_id, sequence)`). Backfill per parent in a data migration:
explode each JSON array element into one component row; for joins assign
`sequence = ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY <array index>)`
— **array position, not `created_at`**, because the JSON array order *is* the
declaration order the compiler honors (`sql_generator.py:237-241`). Keep the JSON
columns through one release (write-both, read-rows), then drop them in a
follow-on. This is independent of and non-conflicting with ADR-051's
`transforms.sequence` migration (disjoint tables, no shared rows; either order).
SQLite/PG compat: `parent_type` as `String(10)` + CHECK; UUID PKs via the
existing `uuidv7()` server default; polymorphic cascade is repository-enforced
(no two-target SQL FK). DDL is DISTILL/DELIVER scope; this ADR records the shape,
not the columns.

## Non-goals

- **Folding View/Report into the Dataset-staging `transforms` table.** ADR-051
  Finding 2's operative decision stands — these are declarative relations, not
  rows in the staging operations list. This ADR normalizes them into their *own*
  component tables.
- **Normalizing `source_refs` this phase.** A `relation_sources` table is a
  separable follow-on (Open question 1).
- **An outbound operations→M renderer.** Admitted by the dispatch catalog
  (decision 4), deferred — inherited posture from ADR-051 decision 2.
- **Reintroducing stored executable translation logic.** Rules-as-data stays
  rejected (decision 4) — permanent non-goal inherited from ADR-026.

## Considered options

### Table shape
- **A. Keep embedded JSON, type Report dicts only (rejected).** Does not deliver
  the queryable flat IR; agent write path stays whole-array-rewrite.
- **B. Parallel per-aggregate normalized tables (rejected).** Re-duplicates the
  kernel in the schema after the domain pass removed it; cross-role queries need
  UNIONs.
- **C. Shared component tables with a parent discriminator (CHOSEN).** Schema
  expresses the kernel; one backfill per component; report-only aggregation as an
  additive table.

### Ordering
- **A. Global `sequence` on every component (rejected).** Assigns
  correctness-bearing order to commutative components; meaningless across tables.
- **B. `sequence` on joins only, `position` on columns (CHOSEN).**
- **C. Partial-order DAG on joins (rejected).** Over-engineered; View joins are a
  linear left-deep chain.

### Renderer
- **A. Keep two independent compilers (rejected).** Kernel-render steps stay
  duplicated.
- **B. One kernel visitor + report extension composes it (CHOSEN).**
- **C. One merged compiler with a mode branch (rejected).** Re-couples the
  lifecycles; the schema-Option-A smell in the renderer.

## Consequences

### Positive
- The IR becomes flat, queryable, row-per-component; SQL still always derived
  (ADR-026 invariant intact).
- Report's dict-soup is lifted onto the shared typed kernel — the modeling debt
  the domain pass diagnosed is paid.
- The schema expresses the shared kernel once; adding a component is one
  catalog/visitor edit (ADR-051 decision 4 inherited); the agent's
  `addFilter`/`addColumn` becomes a single-row INSERT.
- "Order is data where the compiler honors it" is true across all three tiers
  after this and ADR-051 land.

### Negative / accepted trade-offs
- Five new tables + a data migration (expand/contract) per parent.
- Polymorphic `(parent_type, parent_id)` reference: no single SQL cascade FK;
  cascade is repository-enforced + a CHECK constraint.
- A renderer refactor (merge shared steps into the kernel visitor) with
  behavioral-drift risk during the merge — mitigated by a self-contained in-test
  equivalence assertion (the consolidated renderer produces the same SQL as the
  separate compilers for a relation built in the test). There is no
  legacy/production View or Report data, so no characterization snapshot or
  walking-skeleton gate is used.

### Operational
- No new runtime dependency; ibis already ratified (ADR-007) and extended
  (ADR-026). No external integration introduced — no contract-test annotation
  required.
- **Migration is not a trivial column add.** DISTILL/DELIVER must resolve, as for
  ADR-051: non-NULL `sequence` for joins inserted concurrently with the backfill;
  deploy ordering so row-path loaders never hit un-backfilled rows; a rollback
  path; the polymorphic-cascade enforcement choice (repository path vs trigger).

## Cross-decision composition

- **ADR-052 ↔ ADR-051 — composes alongside, reconciles Finding 2.** ADR-051's
  operative decision (do not fold View/Report into the staging `transforms`
  table) stands; this ADR normalizes them into their own component tables
  instead. Finding 2's *justification by "different vocabularies"* was overturned
  by the domain pass; the correct justification is lifecycle + ordering-invariant
  difference, which this ADR preserves (per-parent join `sequence`, not a global
  cross-operation sequence). ADR-051 decision 4 (dispatch catalog + visitor per
  target) and decision 5 (boundary validation via discriminated unions) are
  applied verbatim to this tier.
- **ADR-052 ↔ ADR-026 — composes within.** The component rows are *data*; ibis/
  SQL are always derived; rules-as-data stays rejected. The ibis-literal closure
  for filter values (ADR-026 MR-1, `sql_generator.py:328-364`) is preserved
  unchanged — no new injection surface.
- **ADR-052 ↔ ADR-007 — builds on.** ibis remains the SQL generator; the kernel
  visitor + report extension emit through `ibis.to_sql(dialect="duckdb")` exactly
  as today.

## Acceptance Criteria

Behavioral outcomes the implementation must satisfy (WHAT, not HOW; verified in
DISTILL/DELIVER):

- **Reproducibility invariant.** The compiled SQL for a view/report is always
  derivable from its persisted component rows alone; no path reads SQL or a
  compiled ibis expression back as authority.
- **Render equivalence across the migration.** For a view or report built in a
  test, the SQL rendered from the normalized component rows is byte-identical to
  the SQL rendered from the embedded JSON arrays — a self-contained in-test
  pre-vs-post equivalence (there is no legacy/production data to pin a snapshot
  against).
- **Join order honored.** Swapping the `sequence` of two `relation_joins` rows
  for the same parent produces different SQL; reordering filters, columns, grain
  keys, or aggregations does not.
- **Validation at the boundary.** A malformed component (unknown `semantic_role`,
  invalid role/type pair, measures-without-dimension on a report) is rejected at
  the use-case boundary with a structured error and is **not** persisted; it
  never reaches the renderer.
- **Renderer completeness.** Every component discriminator (each filter operator,
  each column role, each measure aggregation) is handled by every active visitor;
  an unhandled discriminator is a build-time failure, not a silent skip.
- **Single-row write.** Adding one filter/column/join to an existing relation is
  a single-row INSERT, not a whole-array rewrite.
- **Tenant scoping.** Every component row carries `org_id`; loading a relation's
  components is an `org_id`-scoped indexed query.

## Earned Trust — probes the design mandates

Probes split by the wave that can execute them:

**DESIGN-deliverable (executable without new runtime):**
1. **Renderer-completeness probe.** Static check: every component discriminator
   has an entry in every active visitor (decision 4). A skipped discriminator
   breaks reproducibility.

**DELIVER-gated (depend on the migration + normalized tables existing):**
2. **Render-equivalence probe.** For an in-test fixture, the embedded-JSON-array
   render == the normalized-row render, byte-identical — a self-contained
   pre-vs-post assertion, not a characterization snapshot of existing relations.
3. **Join-order probe.** `compile(joins) != compile(joins_with_two_swapped)`;
   `compile(filters) == compile(reordered_filters)` — order honored exactly where
   the schema says it is.
4. **Boundary-rejection probe.** The system refuses to persist a component it
   cannot render (decision 3 is itself the write-path probe).
5. **Polymorphic-cascade probe.** Deleting a parent removes exactly its component
   rows and no others' (validates the repository-enforced cascade since no SQL FK
   guards it).

## Open questions

1. **Normalize `source_refs` into a `relation_sources` table?** Would turn the
   dependency-graph DFS (`dependency_service.py:50-64`) into a SQL query.
   Separable follow-on; not required for the column/filter/join flattening.
2. **`fact`/`dimension` `report_type`: structural or label?** The compiler does
   not branch on it today (`report_ibis_compiler.py`). Confirm at DISTILL before
   treating it as more than a typed attribute (carried over from domain-model §8).
3. **`relation_grain` cardinality:** one row per parent vs one row per grain key
   (resolve at DISTILL; one-row-per-parent matches `ViewGrain` 1:1).
4. **Polymorphic-cascade enforcement:** repository delete path + CHECK
   (recommended) vs DB triggers vs falling back to per-parent tables (resolve at
   DELIVER with the migration).

## References

- `backend/app/models/view.py:27-203` — View typed value-object kernel to promote.
- `backend/app/models/report.py:36-67` — Report aggregate; `columns_metadata` dict-soup.
- `backend/app/repositories/metadata/view_record.py:43-46` — View embedded-JSON columns.
- `backend/app/repositories/metadata/report_record.py:45` — Report `columns_metadata`.
- `backend/app/repositories/metadata/transform_record.py:65-70` — per-row provenance FK pattern.
- `backend/app/use_cases/view/sql_generator.py:205-258` — View compiler (kernel-render steps to share).
- `backend/app/use_cases/report/report_ibis_compiler.py:63-123` — Report compiler (aggregate-over-grain step to keep).
- `backend/app/use_cases/report/column_validation.py:26-50` — hand-rolled validation to retire.
- `backend/app/use_cases/view/dependency_service.py:10-64` — shared composition service to extend.
- `backend/app/use_cases/report/create_report.py:109-131` — no-mart-to-mart + measures-require-dimension rules.
- `docs/decisions/adr-051-operations-as-canonical-transform-ir.md`,
  `docs/decisions/adr-026-ibis-as-only-sql-compiler.md`,
  `docs/decisions/adr-007-ibis-for-sql-generation.md`.
- `docs/feature/normalize-view-report-operations/design/domain-model.md` — settled aggregate boundary (Option B).
