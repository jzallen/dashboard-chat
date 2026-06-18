# C4 Component — Transform Operations IR + Multi-Renderer Topology

Level 3 (Component) diagram of the operations-IR proposal. Shown because the
multi-renderer + sidecar + View/Report-sibling topology is the load-bearing
part of the proposal and benefits from an explicit picture. Every arrow is
labeled with a verb. ibis/SQL are always on the *derived* (outbound) side; the
persisted operations list is the only authority.

```mermaid
C4Component
  title Component Diagram — Transform Operations IR (Dataset staging tier)

  Person(user, "Author", "Human or agent issuing model changes")
  System_Ext(excel, "Excel / Power Query", "Emits M (Power Query) script")

  Container_Boundary(backend, "Backend (FastAPI)") {
    Component(mparser, "Bounded M Parser", "operation→ inbound visitor", "Recognizes the M subset that maps to the operation vocabulary; rejects out-of-vocabulary M")
    Component(validator, "Operation Validator", "Pydantic discriminated union", "Validates operation shape at the use-case boundary BEFORE persistence")
    Component(usecase, "Transform Use Cases", "create/update_transforms", "Application boundary; rejects malformed operations")
    ComponentDb(ops, "Operations (transforms)", "RDBMS table", "Canonical, persisted, sequenced list of operations — SOURCE OF TRUTH")
    ComponentDb(ibisargs, "operation_ibis_args", "sparse sidecar", "Internal-only ibis render deltas; one optional row per operation")
    ComponentDb(margs, "operation_m_args", "sparse sidecar", "Internal-only M render deltas; one optional row per operation")
    Component(catalog, "Operation Dispatch Catalog", "code", "One entry per operation discriminator; carries validate + render rules")
    Component(ibisrender, "ibis Renderer", "visitor over discriminator", "operations → ibis Table (MUTATE→FILTER→RENAME, ordered by sequence)")
    Component(mrender, "M Renderer", "visitor over discriminator", "operations → M (optional outbound)")
    Component(displayrender, "Display Renderer", "visitor over discriminator", "operations → human-readable SQL string")
    Component(ibis, "ibis", "compiler", "Compiles the ibis Table to dialect SQL — DERIVED, never stored")
  }

  System_Ext(duckdb, "DuckDB / dbt eject", "Consumes derived SQL")

  Rel(user, usecase, "Issues model changes to")
  Rel(excel, mparser, "Provides M script to")
  Rel(mparser, validator, "Emits neutral operations to")
  Rel(usecase, validator, "Validates operations through")
  Rel(validator, ops, "Persists sequenced operations into")
  Rel(ops, ibisargs, "May carry ibis deltas in")
  Rel(ops, margs, "May carry M deltas in")

  Rel(ibisrender, catalog, "Dispatches on discriminator via")
  Rel(mrender, catalog, "Dispatches on discriminator via")
  Rel(displayrender, catalog, "Dispatches on discriminator via")

  Rel(ops, ibisrender, "Is rendered (in sequence) by")
  Rel(ibisargs, ibisrender, "Shapes per-instance render in")
  Rel(ops, mrender, "Is rendered by")
  Rel(margs, mrender, "Shapes per-instance render in")
  Rel(ops, displayrender, "Is rendered by")

  Rel(ibisrender, ibis, "Builds ibis Table for")
  Rel(ibis, duckdb, "Compiles derived SQL to")
```

## Reading notes

- **Authority direction.** Everything flows *out of* `Operations`. The M parser
  is the only inbound writer (besides direct use-case authoring); ibis and SQL
  are strictly downstream and never read back into the operations table.
- **Bounded parser.** The M Parser sits *before* the validator — an
  out-of-vocabulary M construct is rejected at parse time, never half-imported.
- **Sidecars.** `operation_ibis_args` / `operation_m_args` are sparse and
  internal; they shape *render*, not *intent*. A renderer left-joins its own
  sidecar; absence means "render the neutral operation faithfully".
- **One catalog, many visitors.** The dispatch catalog is the single place an
  operation's rules live; each renderer is a visitor over the same
  discriminator. Completeness across visitors is enforced by a static probe.

## View / Report relationship (siblings, not shared rows)

```mermaid
C4Component
  title Sibling structured IRs in the ibis-compiler family

  ComponentDb(ops, "Operations (transforms)", "sequenced list", "Staging: row/column shaping, ORDER MATTERS")
  ComponentDb(viewir, "View IR", "structured aggregate", "columns / joins / filters / grain — order-insensitive")
  ComponentDb(reportir, "Report IR", "structured aggregate", "columns_metadata (dimensions + measures) — aggregation")

  Component(ibisfamily, "ibis compiler family", "code", "Shared discipline: operations-as-data, rendering-as-code, SQL always derived, no stored executable SQL (ADR-026)")

  Rel(ops, ibisfamily, "Compiled by (staging renderer)")
  Rel(viewir, ibisfamily, "Compiled by (ViewIbisCompiler)")
  Rel(reportir, ibisfamily, "Compiled by (ReportIbisCompiler)")
```

The three IRs are unified by a shared *discipline*, not a shared table. Only the
staging operations list carries the `sequence` ordering invariant.
