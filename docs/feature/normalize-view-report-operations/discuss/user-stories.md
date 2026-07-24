# User Stories — Normalize View/Report Operations

**Wave:** DISCUSS · **Feature:** `normalize-view-report-operations` · **Linear:** DC-78
**JTBD traceability:** JTBD analysis skipped (internal backend refactor). Each story
instead traces to an **ADR-052 Acceptance Criterion** (AC1–AC7) and/or **Earned-Trust
probe** (P1–P5), which are the validated behavioral specs for this feature.

ADR-052 acceptance criteria, referenced below as AC#:
AC1 reproducibility · AC2 render-equivalence · AC3 join-order-honored ·
AC4 boundary-validation · AC5 renderer-completeness · AC6 single-row-write ·
AC7 tenant-scoping. Probes: P1 completeness · P2 render-equivalence · P3 join-order ·
P4 boundary-rejection · P5 polymorphic-cascade.

Stories are LeanUX. "User" = the human modeler acting through the agent/UI/API, or
the engineer maintaining the renderer. Every non-`@infrastructure` story carries an
Elevator Pitch referencing a real entry point.

---

## Story 01 — Reject a malformed report column at the boundary

As a **modeler authoring a report**, I want an invalid column (unknown
`semantic_role`, illegal role/type pair) rejected the moment I submit it, so a
malformed projection can never reach the renderer and produce a broken mart.

### Elevator Pitch
Before: `reports.columns_metadata` is `list[dict]` hand-validated by `validate_columns_metadata`; a malformed shape can slip through and surface as a render-time crash.
After: run `POST /api/projects/{project_id}/reports` with a column carrying an unknown `semantic_role` → sees a structured `422` naming the offending field, and nothing is persisted.
Decision enabled: the modeler immediately corrects the column instead of discovering a broken report when it renders.

### Acceptance criteria
- Given a report payload with an unknown `semantic_role`, when submitted, then the use case returns a structured `Failure` / `422` and persists nothing. *(AC4, P4)*
- Given a report payload with an invalid role/type pair, when submitted, then it is rejected at the boundary by the discriminated union, not by `validate_columns_metadata`. *(AC4)*
- Given every existing report, when loaded through the new typed `ProjectionColumn`/`Measure` kernel, then it hydrates without error (production-shape coverage).
- `validate_columns_metadata` is retired; Report columns are Pydantic discriminated unions over `semantic_role`, mirroring `ViewFilterVariant` over `operator`.

Traces: AC4, P4 · ADR-052 decision 3 · domain-model §2.5.

---

## Story 02 — Render every relation through one kernel visitor

As an **engineer maintaining the renderer**, I want the View and Report compilers'
shared steps collapsed into one kernel visitor that the report extension composes,
so a kernel change is one edit and an unhandled component fails the build.

### Elevator Pitch
Before: `ViewIbisCompiler` and `ReportIbisCompiler` duplicate the build-source/map-types/project steps; a kernel change means editing both and they can drift.
After: run `cd backend && uv run pytest tests/.../test_render_equivalence.py` after the merge → the pre-normalization and post-normalization render paths produce identical SQL for a fixture built in the test, and adding an unhandled component discriminator makes `pytest` fail at collection/build time.
Decision enabled: the engineer adds a new component or render target by editing one catalog/visitor and trusts the completeness check to flag any gap.

### Acceptance criteria
- Given a relation fixture built in the test, when it is rendered through both the pre-normalization compiler path and the consolidated kernel-visitor path, then the two produce identical SQL (in-test render-equivalence property, no legacy snapshot). *(AC2, P2)*
- Given a component discriminator with no entry in an active visitor, when the build/test runs, then it fails — not a silent skip. *(AC5, P1)*
- Given an entity-only report, when rendered, then it is "the kernel visitor's output with no aggregation step," not a special-cased branch. *(ADR-052 decision 4)*
- No path reads compiled SQL or a compiled ibis expression back as authority. *(AC1)*

Traces: AC1, AC2, AC5, P1, P2 · ADR-052 decision 4 · **blocked by Story 01**.

---

## Story 03 — Add one filter as a single-row INSERT (pattern-prover)

As a **modeler refining a relation through chat**, I want adding a filter to write a
single row, so the agent's `addFilter` no longer rewrites the whole array and I can
query "which relations filter on column X" directly.

### Elevator Pitch
Before: a filter lives inside the `views.filters` JSON array; `addFilter` reads → mutates in memory → rewrites the whole array; "which relations filter on X" is not a SQL query.
After: run the agent `addFilter` tool (→ `PATCH /api/views/{view_id}`) → sees exactly one new row in `relation_filters`, and `SELECT * FROM relation_filters WHERE column='X'` returns the matching relations.
Decision enabled: an operator can audit and target filters across all relations with a SQL query instead of scanning JSON blobs.

### Acceptance criteria
- Given an existing relation, when one filter is added, then exactly one `relation_filters` row is inserted (no whole-array rewrite). *(AC6)*
- Given the migration, when it backfills, then every JSON `filters` element becomes one row keyed by `(parent_type, parent_id)`, and the renderer reads filters from rows. *(ADR-052 decision 5)*
- Given two filters reordered, when the relation renders, then the SQL is unchanged (filters commutative — no order column). *(AC3 negative arm)*
- Given a parent delete, when it executes, then exactly its filter rows are removed and no others'. *(P5, AC7)*
- Every `relation_filters` row carries indexed `org_id`; loads are `org_id`-scoped. *(AC7)*
- The JSON `filters` column is retained this release (write-both, read-rows).

Traces: AC6, AC7, P5 · establishes the shared component-table repository + polymorphic cascade reused by Stories 04–07.

---

## Story 04 — Query columns across views and reports in one place

As a **modeler / operator**, I want every projected column to be a row in one shared
table, so I can ask "which relations project column X" across both views and reports
with a single query and Report's columns sit on the same kernel as View's.

### Elevator Pitch
Before: view columns live in `views.columns` JSON; report columns live in `reports.columns_metadata` JSON — no cross-role query, two shapes.
After: run `SELECT parent_type, parent_id FROM relation_columns WHERE output_name='X'` → sees both views and reports that project column X in one result set.
Decision enabled: an operator traces a column's blast radius across the whole model before renaming or dropping it.

### Acceptance criteria
- Given views and reports, when migrated, then both write `ProjectionColumn` rows to `relation_columns` (shared `ColumnRole` entity/dimension/time/measure). *(ADR-052 decision 1)*
- Given `relation_columns.position`, when columns are reordered, then rendered SQL is unaffected (position is presentation-only). *(AC3 negative arm)*
- Given an added column, when written, then it is a single-row INSERT. *(AC6)*
- Given a fixture built in the test, when rendered from JSON versus from `relation_columns` rows, then the SQL is identical (in-test render-equivalence). *(AC2)*
- Tenant scoping + polymorphic cascade per Story 03. *(AC7, P5)*

Traces: AC2, AC6, AC7 · **blocked by Stories 01, 03** · proves the shared-projection claim.

---

## Story 05 — Honor join order through an explicit sequence

As a **modeler composing multi-source views**, I want join order preserved as
explicit row sequence, so the compiled SQL is identical before and after
normalization and reordering joins changes the result deterministically.

### Elevator Pitch
Before: join order is implicit in `views.joins` JSON array position — fragile and non-queryable.
After: run the in-test render-equivalence check after migration → the JSON path and the row path produce identical join SQL (sequence backfilled by array position), and swapping two `relation_joins.sequence` values changes the rendered `JOIN` order.
Decision enabled: the engineer trusts that normalization preserved join semantics, and can reorder joins by editing a `sequence` value.

### Acceptance criteria
- Given the migration, when joins backfill, then `sequence = ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY <array index>)` — array position, not `created_at`. *(ADR-052 decision 5)*
- Given two `relation_joins` rows with swapped `sequence`, when rendered, then the SQL differs. *(AC3, P3)*
- Given a fixture built in the test, when joins read in `sequence` order, then the row path renders identical SQL to the JSON path (in-test render-equivalence). *(AC2, P2)*
- `relation_joins` indexes `(parent_id, sequence)`; rows carry indexed `org_id`. *(AC7)*

Traces: AC2, AC3, AC7, P2, P3 · **blocked by Story 03** · proves array-position == declaration-order.

---

## Story 06 — Normalize grain into queryable rows

As a **modeler**, I want a relation's grain (time column + dimension keys) stored as
rows, so the grain is queryable and feeds the report aggregation step from one place.

### Elevator Pitch
Before: grain lives in the `views.grain` JSON column, opaque to queries.
After: run `SELECT * FROM relation_grain WHERE parent_id='<id>'` → sees the relation's grain keys as rows.
Decision enabled: the operator inspects and compares grain across relations without parsing JSON.

### Acceptance criteria
- Given the migration, when grain backfills, then it produces one row per parent (≅ `ViewGrain` 1:1 — confirm OQ-3 at DISTILL). *(ADR-052 OQ-3)*
- Given grain keys reordered, when rendered, then SQL unchanged (set-like, no order column). *(AC3 negative arm)*
- Given a fixture built in the test, when rendered from the JSON path versus from `relation_grain` rows, then the SQL is identical (in-test render-equivalence). *(AC2)*
- Tenant scoping + cascade per Story 03. *(AC7, P5)*

Traces: AC2, AC7 · **blocked by Story 03** · resolves OQ-3.

---

## Story 07 — Reject a dimensionless or mart-to-mart report on typed rows

As a **modeler authoring a fact report**, I want measure-requires-dimension and
no-mart-to-mart enforced over the normalized rows, so an aggregation with no grain or
a report sourcing another report is rejected at the boundary with a clear error.

### Elevator Pitch
Before: `ReportRequiresDimension` and `InvalidReportReference` are inline checks over dicts in `create_report.py`.
After: run `POST /api/projects/{project_id}/reports` with a measure and no dimension → sees a structured `422` (`ReportRequiresDimension`); a report whose `source_refs` point at another report → structured `422` (`InvalidReportReference`).
Decision enabled: the modeler fixes the grain or the source before the report is ever persisted or rendered.

### Acceptance criteria
- Given a report with ≥1 measure and no dimension, when submitted, then `ReportRequiresDimension` rejects it over typed rows (not dict probes). *(AC4)*
- Given a report sourcing another report, when submitted, then `InvalidReportReference` rejects it via a first-class method on the shared composition service (peer to View's circular-dependency arm). *(AC4)*
- Given a valid measure, when written, then exactly one `relation_aggregations` row (report-only) binds measure → aggregation function. *(ADR-052 decision 1, AC6)*
- Aggregations reordered → rendered SQL unchanged (independent aggregates). *(AC3 negative arm)*
- Given a fixture built in the test, when rendered from the JSON path versus from `relation_aggregations` rows, then the SQL is identical (in-test render-equivalence); tenant scoping + cascade per Story 03. *(AC2, AC7, P5)*

Traces: AC2, AC4, AC6, AC7 · **blocked by Stories 04, 06** · resolves OQ-2 (report_type structural vs label) at DISTILL.

---

## Story 08 — Retire the embedded-JSON columns `@infrastructure`

As an **engineer**, I want the now-unread JSON columns dropped after one safe
release, so the schema holds one source of truth and the write-both bridge is removed.

> `@infrastructure` — no user-visible output. This is the **contract** half of
> expand/contract; it cannot release on its own and is gated behind one production
> release in which Stories 03–07 have run read-from-rows successfully.

### Acceptance criteria
- Given Stories 03–07 shipped and read-from-rows confirmed in production for one release, when this migration runs, then `views.{columns,joins,filters,grain}` and `reports.columns_metadata` are dropped.
- Given the drop, when a fixture built in the test renders, then it produces the same SQL as before the drop (proves nothing still reads JSON). *(AC2)*
- A rollback path exists (re-add columns + re-backfill from rows) for the release window. *(ADR-052 decision 5)*

Traces: AC2 · **blocked by Stories 03, 04, 05, 06, 07** + one-release gate.

---

## Requirements completeness

| ADR-052 AC / probe | Covered by |
|---|---|
| AC1 reproducibility | 02 |
| AC2 render-equivalence | 02, 04, 05, 06, 07, 08 (in-test pre-vs-post render-equivalence property, per story) |
| AC3 join-order-honored | 03, 04, 05, 06, 07 (positive in 05; negative arms elsewhere) |
| AC4 boundary-validation | 01, 07 |
| AC5 renderer-completeness | 02 |
| AC6 single-row-write | 03, 04, 07 |
| AC7 tenant-scoping | 03, 04, 05, 06, 07 |
| P1–P5 probes | 02 (P1, P2), 05 (P3), 01/07 (P4), 03–07 (P5) |

Every ADR-052 acceptance criterion and Earned-Trust probe maps to at least one
story. Render-equivalence (AC2/P2) is proven **per story** as a self-contained
in-test property — each story compares its own pre-normalization render path against
its post-normalization render path for a fixture built inside the test — not against
a legacy characterization snapshot. Completeness: **8/8 stories carry verifiable AC;
every AC/probe covered.**
