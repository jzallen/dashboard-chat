# Application-Architecture Evaluation — Normalize View/Report Operations

**Wave:** DESIGN (application/component scope) · **Mode:** PROPOSE
**Area:** backend · **Type:** brownfield evaluation (`wave:refactor`)
**Author:** Morgan (nw-solution-architect)
**Builds on:** the domain pass (`docs/feature/normalize-view-report-operations/design/domain-model.md`,
Option B — two aggregates sharing a typed Derived-Relation value-object kernel).
The aggregate-boundary question is **settled and not re-litigated here.**
**Composes with:** ADR-051 (operations-as-canonical-transform-IR), ADR-026
(ibis is the only SQL compiler; no stored executable SQL; rules-as-data
rejected), ADR-007 (ibis is the SQL generator).

This pass designs the **flat / normalized persistence + intermediate
representation (IR)** that realizes the Derived-Relation kernel for View and
Report, so the IR maps cleanly onto BOTH input forms (M / Power Query, agent
tool calls like `addFilter`/`addColumn`) and output forms (ibis → SQL). It
produces NO DDL and NO migration (that is DISTILL/DELIVER); it fixes the table
shapes, the IR contract, the rule placement, the renderer boundary, and the
migration *shape*.

All claims are backed by `file:line` evidence read during grounding.

---

## 0. The defect being paid down (one paragraph)

Both aggregates persist their components as **embedded-JSON arrays on a single
entity row**: `columns` / `joins` / `filters` / `grain` on `views`
(`backend/app/repositories/metadata/view_record.py:43-46`) and
`columns_metadata` on `reports`
(`backend/app/repositories/metadata/report_record.py:45`). View's arrays are at
least re-hydrated into typed value objects on read (`view.py:300-340`); Report's
`columns_metadata: list[dict]` is **never typed** — it is hand-validated by a
free function over raw dicts (`report/column_validation.py:26-50`) and consumed
as raw dicts by the compiler (`report_ibis_compiler.py:105-116`). The user's
ask — "a more flat structure that makes the intermediate representation easy to
map to desired input and output forms" — is, concretely, **disaggregate those
JSON arrays into normalized rows, and lift Report's dict-soup onto the same
typed kernel View already has.** This composes with, but is distinct from,
ADR-051's staging `transforms` normalization (already row-per-operation).

---

## Decision 1 — Normalized table shape

**Question.** Row-per-component normalized tables vs embedded JSON vs hybrid?
And if normalized: do View and Report **share** physical component tables (with
a discriminator/FK to either parent) given they share the value-object kernel,
or do they get **parallel** tables?

### Option 1A — Keep embedded JSON, type Report's dicts only (minimal)

Leave `views`/`reports` arrays as JSON columns; the only change is promoting
Report's `columns_metadata` to the same Pydantic value objects View uses.

- **Pros.** Smallest migration (no row explosion; type-only change on read/write).
  No new tables, no new FK fan-out, no new indexes. Honors the brownfield
  economy driver verbatim.
- **Cons.** Does **not** deliver the user's "flat structure." JSON arrays remain
  opaque to SQL-level queries ("which views filter on column X?", "which reports
  aggregate measure Y?") and to the agent-tool write path, which must read →
  mutate-in-memory → rewrite the whole array for a single `addFilter`. No
  per-component identity → no per-component provenance (the `assistant_audit_entry_id`
  reverse-FK that `transforms` rows already carry — `transform_record.py:65-70`
  — cannot attach to a single JSON filter). Leaves the IR a document, not a
  relation; the staging tier moved off this exact shape in ADR-051 for the same
  reason.

### Option 1B — Parallel normalized tables per aggregate (separate-but-symmetric)

`view_columns`, `view_joins`, `view_filters`, `view_grain`; and
`report_columns`, `report_filters`, `report_aggregations`. Each FK'd to its own
parent. Shared *types* in code, **separate physical tables**.

- **Pros.** Each table FK's to exactly one parent → no discriminator, no
  polymorphic FK, simplest referential integrity (standard `ON DELETE CASCADE`
  to one parent). Mirrors the two-aggregate boundary literally. PG/SQLite-trivial.
- **Cons.** Reintroduces the *physical* duplication the domain pass diagnosed as
  debt (§2.5 of the domain model): two `*_columns` tables holding the identical
  kernel shape, two `*_filters` tables, two backfills, two sets of indexes. The
  cross-role queries the user wants ("show every relation, view or report, that
  projects column X") require a UNION across parallel tables. The shared kernel
  exists in code but is invisible in the schema — exactly the "shared concept,
  duplicated structure" smell.

### Option 1C — Shared kernel component tables with a parent discriminator (RECOMMENDED)

One physical table per **kernel component type**, each carrying a
`(parent_type, parent_id)` pair (`parent_type ∈ {view, report}`) plus `org_id`
and `project_id` for tenancy/scoping:

| Table | Holds | Maps kernel VO | Parent(s) |
|---|---|---|---|
| `relation_columns` | one projected output column | `ProjectionColumn` (View's `ViewColumn` promoted; Report's dict-soup replaced) | view OR report |
| `relation_filters` | one boundary-validated predicate | `Filter` (`ViewFilterVariant`) | view OR report |
| `relation_joins` | one declared join | `Join` (View-role only today; column exists, report rows simply never present) | view (report when it gains joins) |
| `relation_grain` | grain dimensions/time (0..1 per parent, or N grain-key rows) | `Grain` (`ViewGrain`) | view OR report |
| `relation_aggregations` | one measure→aggregation binding | `Measure` (report-only specialization) | report only |

`source_refs` stays as-is for this pass (see Decision 1 scope note below).

- **Pros.** The schema *expresses* the shared kernel: one `relation_columns`
  shape serves both roles, killing the duplication 1B reintroduces. Cross-role
  queries are a single `WHERE parent_type=...` filter, not a UNION. One backfill
  per component type, not two. Per-component identity unlocks the same
  per-row provenance FK pattern `transforms` already uses
  (`transform_record.py:65-70`) and lets the agent's `addFilter`/`addColumn`
  tools become a single-row INSERT instead of a whole-array rewrite. The
  report-only `relation_aggregations` table is the **additive structure** the
  domain pass left open (domain-model §8 OQ-1): Report = the shared component
  tables + this one extra table, which is the schema-level expression of "a
  Report is a View plus one structural operator."
- **Cons.** Polymorphic parent reference: `(parent_type, parent_id)` cannot be a
  single SQL FK with `ON DELETE CASCADE` to two tables. Mitigation: enforce
  cascade in the repository's delete path (the repository already owns
  multi-table writes via `@with_repositories` auto-commit — backend convention,
  CLAUDE.md) and add a CHECK constraint on `parent_type`. A composite index
  `(org_id, parent_type, parent_id, sequence?)` is required on every component
  table for tenant-scoped load (the `alembic-migration` org_id-indexing
  convention). Slightly more conceptual surface than 1B for readers who expect
  one-table-per-parent.

**Recommendation: Option 1C.** It is the only option that makes the *schema*
carry the shared kernel the domain pass mandated, delivers the user's flat
structure with queryable per-component rows, and gives the report-only
aggregation its honest additive home. The polymorphic-FK cost is real but is a
known, repository-enforced pattern, not a novel risk. Option 1A is rejected as
not delivering the ask (JSON stays opaque); Option 1B is rejected because it
re-duplicates the kernel in the schema after the domain pass spent its argument
removing that duplication.

> **Discriminator naming.** `parent_type` (not `kind`) — `kind` was the Option-A
> single-aggregate discriminator the domain pass *rejected*; reusing the word
> here would imply a god-aggregate. `parent_type` names the FK target, not an
> aggregate mode. The two aggregate roots stay distinct (domain Option B); the
> shared tables are a *persistence* sharing, not an aggregate merge.

> **Scope note — `source_refs`.** This pass keeps `source_refs` as the existing
> JSON column on both parents. Normalizing it into a `relation_sources` table is
> defensible (it would let the dependency graph be a SQL query instead of a
> recursive in-Python DFS — `dependency_service.py:50-64`) but is a **separable
> follow-on**: it does not block the column/filter/join/aggregation flattening
> the user asked for, and the DFS works today. Flagged as OQ-1.

---

## Decision 2 — The flat IR (and whether it needs a sequence/order column)

**Question.** What is the IR that input adapters (M parser, agent tools) write
and output renderers (ibis) read, and — reconciling with ADR-051's *sequenced*
`transforms` list — does the normalized View/Report IR need a `sequence` column,
a partial order, or none? Be precise per component type.

The ADR-051 staging IR is a **single sequenced operation list** because the
MUTATE chain is non-commutative across operations (`dataset_sql.py:108-110`;
ADR-051 decision 1). View/Report are **declarative one-shot relations** compiled
in a single pass (`sql_generator.py:205-258`, `report_ibis_compiler.py:63-123`),
NOT a cross-operation mutate chain. So the answer is **per-component-type**, not
one global rule. The domain pass already established the ordering facts
(domain-model §2.2): View *joins* are declaration-ordered; Report's
columns_metadata order is incidental.

### Per-component ordering verdict

| Component table | Order semantics | Needs `sequence`? | Evidence |
|---|---|---|---|
| `relation_joins` | **Declaration-ordered.** The compiler chains joins in list order — `for join in view.joins: expr = expr.join(...)` — and join order changes the plan shape | **YES — `sequence: int NOT NULL`, scoped per parent** | `sql_generator.py:237-241` |
| `relation_columns` | **Set-like.** SELECT projection; output column order is a presentation nicety, not a correctness invariant. Report dims/measures are filtered by role, not iterated as a sequence | **NO — `position: int NULL`** (presentation hint only, never a correctness input) | `report_ibis_compiler.py:105-107`; `sql_generator.py:248-256` |
| `relation_filters` | **Commutative.** WHERE conjunction; AND is order-insensitive (matches ADR-051's note that filter ops are commutative within their stage) | **NO** | `sql_generator.py:243-246`; ADR-051 decision 1 note |
| `relation_grain` | **Set of keys.** GROUP BY key set; order-insensitive | **NO** | `report_ibis_compiler.py:115,122` |
| `relation_aggregations` | **Set.** Each measure is an independent aggregate output | **NO** | `report_ibis_compiler.py:116` |

### Options for expressing this

- **Option 2A — One global `sequence` on every component row (mirror ADR-051
  verbatim).** Uniform with staging. **Rejected:** it would assign a
  correctness-bearing `sequence` to filters/columns/grain that have no ordering
  invariant, re-creating exactly the "uniform-but-mostly-unused" tension ADR-051
  itself flagged ("`sequence` is required only for the non-commutative MUTATE
  arm" — ADR-051 decision 1 note). Worse: a global sequence across *different
  component tables* has no meaning (a join and a filter do not interleave).

- **Option 2B — `sequence` only where the order is load-bearing (RECOMMENDED).**
  `relation_joins.sequence: int NOT NULL` (per-parent), `relation_columns.position:
  int NULL` (presentation only), nothing on filters/grain/aggregations. The IR's
  ordering contract is **explicit and minimal**: order is data only where the
  compiler honors it, and the schema says so.

- **Option 2C — Partial order via a `depends_on` edge on joins.** Model join
  ordering as a DAG instead of a linear sequence. **Rejected:** over-engineered;
  View joins are a linear left-deep chain today (`expr = expr.join(...)`
  re-binds `expr` each step), not an arbitrary DAG. A linear `sequence` is the
  faithful model. Revisit only if multi-root join trees ever appear.

**Recommendation: Option 2B.** This is the precise reconciliation with ADR-051:
**both IRs make "order is data" true, but each carries order only where its
compiler is order-sensitive.** Staging needs a global per-dataset `sequence`
(non-commutative MUTATE chain); View/Report need a per-parent `sequence` on
**joins only**, because that is the sole declaration-ordered component
(`sql_generator.py:237-241`). The shared discipline is identical — order is
explicit, never clock-derived (ADR-051's `created_at` anti-pattern is avoided by
construction since these rows are authored, not timestamp-ordered) — but the
shape differs because the algebra differs. This is the same conclusion the
domain pass reached at the value-object level (domain-model §6: "intra-structure
order (the join list) but not a cross-operation sequence"), now made concrete at
the table level.

> **The flat IR, stated.** The IR is the **set of normalized component rows
> keyed by `(parent_type, parent_id)`**, plus the typed value objects that
> validate them at the boundary. Input adapters (M parser, agent tools) write
> component rows; the renderer reads component rows ordered by
> `joins.sequence` and projects everything else as sets. Nothing reads back
> compiled SQL as authority (ADR-026 hard invariant preserved): SQL is always
> re-derived from the persisted component rows.

---

## Decision 3 — Where the business rules sit

**Question.** Confirm/refine that report-vs-view rule variation lives at the
application/use-case boundary (Pydantic discriminated unions mirroring
`ViewFilterVariant`, per ADR-051 decision 5), and that Report's untyped
`columns_metadata` is promoted to typed value objects like View's columns.

This is largely **confirmation** — the domain pass settled the *placement*
(domain-model §2.4 table), this pass pins the *mechanism*.

### 3.1 Report columns_metadata → typed kernel value objects (CONFIRMED, mechanism pinned)

Promote `columns_metadata: list[dict]` to a Pydantic discriminated union over
`semantic_role`, exactly mirroring `ViewFilterVariant`'s union over `operator`
(`view.py:154-214`). Concretely:

- `ProjectionColumn` becomes the shared kernel base (promote `ViewColumn`,
  `view.py:51-56`); its `grain_role`/`ColumnRole` enum is generalized to cover
  Report's `entity`/`dimension`/`measure` so the `GrainRole.Metric` ≅ Report
  `measure` drift (domain-model §2.1) collapses to one enum.
- A `MeasureColumn` variant (the report-only specialization) carries the bound
  aggregation function (`sum`/`count`/`count_distinct`/`avg`/`min`/`max` —
  `report_ibis_compiler.py:37-44`) and the `time_granularity` that
  `column_validation.py:45-48` validates by hand today.
- The hand-rolled `validate_columns_metadata` (`column_validation.py:26-50`)
  **retires**: the role/type-pair table (`VALID_TYPES_BY_ROLE`,
  `column_validation.py:9-13`) becomes per-variant Pydantic `Literal` typing,
  so a malformed pair is rejected by the type adapter at the boundary, not by a
  free function the renderer might be reached without.

### 3.2 Report-only rules stay at the application boundary (CONFIRMED)

| Report rule | Today | After |
|---|---|---|
| `report_type ∈ {fact, dimension}` | string field (`report.py:41`) | typed `Literal` on the Report aggregate (a typed attribute, not a structural rule — domain-model §2.4) |
| measures-require-dimension (`ReportRequiresDimension`) | inline check at `create_report.py:128-131` | stays at the use-case boundary; now expressible because dims/measures are typed kernel rows, not dict probes |
| no-mart-to-mart (`InvalidReportReference`) | inline at `create_report.py:109-110` | promote to a first-class method on the shared composition service (today's `DependencyService`, `dependency_service.py`) — it is application policy on the dependency graph (domain-model §2.4), peer to View's circular-dependency arm |

**Recommendation: confirm, with the discriminated-union mechanism above.** This
is ADR-051 decision 5 ("validation moves to the application boundary via a
Pydantic discriminated union over the operation discriminator, mirroring
`ViewFilterVariant`") applied verbatim to the View/Report kernel: the
discriminator is `semantic_role` for columns and `operator` for filters
(already so for filters). The renderer (Decision 4) is then guaranteed to
receive only well-typed kernel objects — the `"-- Error generating SQL"`
fallback in the staging tier (`dataset_sql.py:49-50`) and its absence in the
view/report compilers stops mattering because malformed components never reach
the compiler.

---

## Decision 4 — Renderer boundary

**Question.** One dispatch catalog / visitor-per-target (ADR-051 decision 4), or
keep the two existing compilers (`view/sql_generator.py`,
`report/report_ibis_compiler.py`)? If unified kernel, can a shared visitor
render the shared components and the report-only steps extend it?

### Option 4A — Keep two independent compilers (status quo)

`ViewIbisCompiler` and `ReportIbisCompiler` stay separate, each consuming its
own input.

- **Pros.** Zero refactor of the compile path. Each compiler is already pure and
  ibis-based (ADR-026-compliant).
- **Cons.** The two compilers already duplicate the kernel-rendering steps:
  both build an `ibis.table(schema, name)` per source (`sql_generator.py:226-232`
  ≈ `report_ibis_compiler.py:102-103`), both resolve display→ibis types
  (`sql_generator.py:41-79` ≈ `report_ibis_compiler.py:126-144`), both project
  columns. Adding a kernel component (say, a new filter operator) means editing
  both. This is the triplication smell ADR-051 decision 4 eliminated for
  staging, present here in duplicate.

### Option 4B — One dispatch catalog + a kernel visitor, report extends it (RECOMMENDED)

A single `relation` rendering module with a **kernel visitor** that renders the
shared components (sources → joins-in-sequence → filters → projection) into an
`ibis.Table`, and a **report extension** that takes the kernel's projected table
and applies the one additional operator (`group_by(grain).aggregate(measures)`).
Each render target (ibis-executable, ibis-display, future M-outbound) is a
visitor keyed on the component discriminator, exactly as ADR-051 decision 4.

- **Pros.** Realizes the domain pass's core finding *in code*: "a Report is a
  View plus one structural operator" becomes "the report visitor calls the
  kernel visitor, then applies aggregate-over-grain." The kernel-render steps
  (table materialization, type mapping, join chaining, filter predicates) are
  written once and shared. Adding a component is one catalog entry; adding a
  target is one visitor (ADR-051 decision 4 verbatim). The entity-only report
  branch (`report_ibis_compiler.py:108-113`) — which the domain pass identified
  as literally a view-style projection (domain-model §2.2) — becomes "the kernel
  visitor's output with no aggregation step," not a special-cased branch.
- **Cons.** A real refactor: collapse the two compilers' shared steps into the
  kernel visitor, keep the report-only aggregate step as the extension. Risk of
  behavioral drift during the merge — mitigated by the existing ADR-026
  byte-identical-SQL discipline (the merged renderer must produce the same SQL
  the two compilers produce for the same relation; pin with a characterization
  test before the merge, per the brownfield walking-skeleton rule in CLAUDE.md).

### Option 4C — Fully merge into one compiler with a mode branch

One `RelationCompiler` with an `if parent_type == report:` aggregate branch.

- **Rejected.** This is the schema-level Option-A (single mode-switched
  aggregate) the domain pass rejected, re-appearing in the renderer. A mode
  branch inside one compiler re-couples the two lifecycles. Option 4B's
  *extension* (report visitor composes the kernel visitor) keeps them composable
  without a mode flag.

**Recommendation: Option 4B.** It is the renderer-level expression of the
Derived-Relation kernel and the direct application of ADR-051 decision 4 to this
tier. The shared visitor renders shared components; the report-only
aggregate-over-grain step *extends* (composes) it rather than branching inside
it. **Rules-as-data stays rejected** (ADR-026, ADR-051 decision 4): the catalog
is code keyed by discriminator, never a stored translation table.

> **Renderer-completeness probe (Earned Trust).** Every component discriminator
> (each filter operator, each column role, each measure aggregation) must have
> an entry in every active visitor; a discriminator a visitor cannot render is a
> **build-time failure, not a silent skip** — the same static check ADR-051's
> renderer-completeness probe mandates. This is the design's first-class probe:
> the merged renderer refuses to build if any kernel discriminator is
> unhandled.

---

## Decision 5 — Migration shape (high level only — no DDL)

**Question.** JSON-array → normalized-rows backfill, and how it composes with
ADR-051's `transforms.sequence` migration. Honor `alembic-migration` conventions
(org_id indexing, SQLite/PG compat) but do not write the migration.

### Shape

1. **Create** the five component tables (Decision 1C) with `org_id` +
   `project_id` indexed and a composite `(org_id, parent_type, parent_id)` index
   per table (`alembic-migration` org_id-indexing convention). `relation_joins`
   additionally indexes `(parent_id, sequence)`.
2. **Backfill, per parent, in a data migration:**
   - explode each `views.columns` / `views.filters` JSON element → one
     `relation_columns` / `relation_filters` row, copying `org_id`/`project_id`
     from the parent;
   - explode `views.joins` → `relation_joins` rows, assigning
     `sequence = ROW_NUMBER() OVER (PARTITION BY view_id ORDER BY <array index>)`
     — **array index, not `created_at`**: the JSON array order *is* the
     declaration order the compiler honors today (`sql_generator.py:237-241`), so
     the backfill must preserve array position, not timestamp. (This is the
     View/Report analog of ADR-051's `ROW_NUMBER()` backfill, but partitioned by
     parent and ordered by array position rather than `created_at`.)
   - explode `reports.columns_metadata` → `relation_columns` rows (role/type from
     each dict) **plus** `relation_aggregations` rows for `semantic_role=measure`
     entries (binding the aggregation function);
   - `views.grain` → `relation_grain` row(s).
3. **Keep the JSON columns through one release** (expand/contract): write to both
   shapes, read from rows, drop the JSON columns in a follow-on migration once
   the row path is proven. This mirrors the safe-migration posture ADR-051's
   §Operational notes mandates for the `sequence` backfill (non-NULL on
   concurrent inserts, deployment ordering, rollback path).
4. **SQLite/PG compat:** `parent_type` as `String(10)` with a CHECK constraint
   (both engines support CHECK); UUID PKs via the existing `uuidv7()`
   server-default pattern (`view_record.py:31`); `ON DELETE CASCADE` to the
   single typed parent is not available (polymorphic), so cascade is
   repository-enforced + documented (Decision 1C cons).

### Composition with ADR-051's migration

**Independent, non-conflicting, and sequencing-flexible.** ADR-051 normalizes the
**Dataset-staging `transforms`** table (adds `sequence`, backfills by
`created_at`); this migration normalizes the **View/Report component arrays**
(new tables, backfills joins by array position). They touch disjoint tables and
share no rows. They can land in either order. The *conceptual* composition is
the point: after both land, "order is data where the compiler honors it" is true
across all three tiers — global `sequence` on staging, per-parent `sequence` on
view/report joins, no sequence elsewhere.

**Recommendation: expand/contract backfill, joins ordered by array position, JSON
columns retained one release.** Do not write the DDL here; DISTILL/DELIVER
resolves the same operational checklist ADR-051 enumerated (concurrent-insert
non-NULL `sequence`, deploy ordering so `order_by(sequence)` loaders never hit
un-backfilled rows, rollback path).

---

## Reuse Analysis (DESIGN hard gate)

Every overlapping component classified EXTEND vs CREATE NEW; every CREATE NEW
justified.

| Existing component | File:line | Overlap | Verdict | Justification |
|---|---|---|---|---|
| `views.columns/joins/filters/grain` JSON columns | `view_record.py:43-46` | The View component arrays being normalized | **REPLACE → normalized rows** (retain one release, expand/contract) | The whole point of the user's ask; JSON arrays are opaque/non-queryable/whole-array-rewrite on the agent write path. |
| `reports.columns_metadata` JSON column | `report_record.py:45` | Report's untyped projection — the debt | **REPLACE → `relation_columns` + `relation_aggregations` rows** | Domain pass §2.5: dict-soup is modeling debt; rows + typed VOs are the fix. |
| `ViewColumn` (+ `DisplayType`, `GrainRole`) | `view.py:27-56` | Typed projection-column kernel VO | **EXTEND → promote to `ProjectionColumn`/`ColumnRole`** | Already the typed model; generalize role enum to cover Report `measure`. No second column type forked (domain pass Reuse gate). |
| `ViewFilterVariant` discriminated union | `view.py:154-214` | Boundary-validated filter VO | **REUSE as-is, share to both roles** | Already the ADR-026 MR-1 boundary-validation pattern; it IS the filter kernel. Reports get this, not a new union. |
| `ViewJoin` / `ViewGrain` | `view.py:60-70` | Join + grain VOs | **EXTEND → kernel `Join`/`Grain`** | Join gets a `sequence`; grain shared as-is. |
| `validate_columns_metadata` | `column_validation.py:26-50` | Hand-rolled report-column validation | **REPLACE with discriminated-union validation** | ADR-051 decision 5 mechanism; the free function is the "validation happens too late / in the wrong place" anti-pattern. |
| `ViewIbisCompiler` | `sql_generator.py:96` | Relational-composition compiler | **EXTEND → kernel visitor** (Decision 4B) | Its shared steps (table-build, type-map, join-chain, filter-predicate, project) become the kernel visitor reused by both roles. |
| `ReportIbisCompiler` | `report_ibis_compiler.py:47` | Aggregate-over-grain compiler | **SHRINK → report visitor extension** | Keeps only the report-only `group_by.aggregate` step; the shared steps move to the kernel visitor it composes. |
| `DependencyService` | `dependency_service.py:10-64` | Source-ref existence + cycle validation, already imported by both | **EXTEND → kernel composition service** | Add the no-mart-to-mart arm (today inline at `create_report.py:109`) as a first-class method, peer to the circular-dependency arm. |
| `transforms.sequence` pattern | ADR-051 decision 1; `transform_record.py` | The "order is data" sequencing precedent | **REUSE the pattern, NOT the table** | Apply the explicit-`sequence` discipline to `relation_joins` only (Decision 2B); do not fold view/report into the staging table (ADR-051 Finding 2 operative decision STANDS). |
| `assistant_audit_entry_id` reverse-FK | `transform_record.py:65-70` | Per-row provenance pattern | **REUSE the pattern (optional, follow-on)** | Per-component identity now allows attaching provenance to a single filter/column; flagged as a capability unlocked, not built this pass. |
| `report_type`, `ReportRequiresDimension`, `InvalidReportReference` | `report.py:41`; `create_report.py:109,128` | Report-only attributes/policy | **KEEP at Report aggregate / app boundary** | The genuine "slightly different business rules" — Report-aggregate invariants + app policy on the shared kernel (domain pass §2.4). |

**CREATE NEW inventory (the only net-new artifacts):**

| New artifact | Why no existing alternative |
|---|---|
| 5 component tables (`relation_columns`/`_filters`/`_joins`/`_grain`/`_aggregations`) | No table holds row-per-component kernel data today; JSON arrays are the thing being replaced. The shared physical tables (1C) are the schema expression of the kernel the domain pass mandated. |
| `relation_aggregations` table specifically | The report-only additive structure (domain-model §8 OQ-1). No existing table models a measure→aggregation binding as a row; `columns_metadata` conflated it into dict-soup. |
| Kernel render module (Decision 4B) | A *new home* for the shared visitor, justified exactly as the domain pass justified the kernel module: no current module is the home for cross-role rendering — today `sql_generator.py` owns it and `report_ibis_compiler.py` duplicates it. |

**Gate result: PASS.** Every overlapping component is EXTEND / REUSE / REPLACE /
SHRINK of an existing View artifact or the shared `DependencyService`. The
net-new artifacts are the five component tables (the user's explicit ask), the
report-only aggregation table (the additive structure the domain pass left
open), and one render-module home — each justified by "no existing alternative."

---

## Quality attributes (ISO 25010 delta)

| Attribute | Effect |
|---|---|
| **Maintainability / Modularity** | ↑↑ One kernel shape (tables + VOs + visitor) replaces two duplicated ones; adding a component or target is one catalog/visitor edit (ADR-051 decision 4 inherited). |
| **Modifiability (agent write path)** | ↑↑ `addFilter`/`addColumn` become single-row INSERTs instead of read-mutate-rewrite of a JSON array. |
| **Analysability** | ↑ Per-component rows are SQL-queryable ("which relations filter on X?"); JSON arrays were opaque. |
| **Security** | = Filter values still flow through ibis literals (ADR-026 MR-1 closure preserved — `sql_generator.py:328-364`); no new injection surface. Boundary validation moves *earlier* (discriminated unions), strictly improving. |
| **Reliability / Correctness** | = SQL still always re-derived from persisted IR (ADR-026 hard invariant). Migration risk is the main negative, mitigated by expand/contract + characterization test before the renderer merge. |
| **Performance** | ≈ Component-row load is N small rows vs one JSON blob per parent; one indexed query per relation. Negligible for the cardinalities here (tens of columns/filters per relation). |

---

## Open questions (routed downstream)

1. **OQ-1 — Normalize `source_refs` too?** A `relation_sources` table would turn
   the dependency-graph DFS (`dependency_service.py:50-64`) into a SQL query.
   Separable follow-on; not required for the column/filter/join flattening.
   Route to a later pass or a DELIVER stretch goal.
2. **OQ-2 — `fact`/`dimension` `report_type`: structural or label?** The domain
   pass flagged this (domain-model §8). The compiler does not branch on it
   today (`report_ibis_compiler.py` ignores `report_type`). Confirm at DISTILL
   before treating it as anything but a typed attribute on the Report aggregate.
3. **OQ-3 — `relation_grain` cardinality:** one row per parent (time_column +
   dimensions array) vs one row per grain key. One-row-per-parent keeps the
   1:1 mapping to `ViewGrain` (`view.py:68-70`) and is recommended unless
   per-key provenance is wanted; resolve at DISTILL.
4. **OQ-4 — Polymorphic-FK cascade enforcement:** repository-path delete +
   CHECK constraint (this pass's recommendation) vs DB triggers vs per-parent
   tables (Option 1B fallback). Resolve at DELIVER with the migration.
