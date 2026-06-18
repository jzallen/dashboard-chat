# C4 Diagrams — Normalized View/Report IR + Renderer Subsystem

**Wave:** DESIGN (application/component scope) · **Mode:** PROPOSE
**Author:** Morgan (nw-solution-architect)
**Companion:** `evaluation.md` (decisions 1–5), draft `adr-052`.

Scope: the affected backend subsystem only — the normalized View/Report
component tables, the typed Derived-Relation kernel, the input adapters that
write the IR, and the kernel visitor + report extension that render it to ibis →
SQL. Every arrow is labeled with a verb. Levels do not mix.

---

## L2 — Container diagram (the backend tier and its IR neighbours)

Shows where the normalized View/Report IR lives relative to the inbound writers
and the outbound SQL targets. Datastores are normalized component tables, not
JSON blobs.

```mermaid
C4Container
  title Container Diagram — View/Report Normalized IR (backend tier)

  Person(modeler, "Data modeler", "Authors views/reports via chat + UI")
  System_Ext(agent, "Agent (chat brain)", "Hono + Groq — addFilter/addColumn tool calls")
  System_Ext(excel, "Excel / Power Query", "M source of inbound transformations")

  Container_Boundary(backend, "Backend (FastAPI + SQLAlchemy + ibis)") {
    Container(usecases, "View/Report use cases", "Python", "Validates intent at the boundary; writes component rows")
    Container(kernel, "Derived-Relation kernel + renderer", "Python + ibis", "Typed VOs; kernel visitor + report extension; compiles IR to SQL")
    ContainerDb(reldb, "Normalized relation tables", "SQLite/PG", "relation_columns/_filters/_joins/_grain/_aggregations keyed by (parent_type, parent_id)")
    ContainerDb(parents, "views + reports parents", "SQLite/PG", "Aggregate roots; report_type, materialization, source_refs")
  }

  System_Ext(duckdb, "query-engine (DuckDB)", "Executes derived SQL for preview")
  System_Ext(dbt, "dbt export", "Receives ref-mode SQL for the customer mart/intermediate layers")

  Rel(modeler, agent, "Describes changes in natural language to")
  Rel(agent, usecases, "Calls addFilter / addColumn / addJoin on")
  Rel(excel, usecases, "Imports M transformations through (bounded parser, ADR-051)")
  Rel(usecases, reldb, "Writes one row per component to")
  Rel(usecases, parents, "Writes aggregate-root attributes to")
  Rel(kernel, reldb, "Reads component rows (joins by sequence) from")
  Rel(kernel, parents, "Reads parent attributes from")
  Rel(usecases, kernel, "Re-derives SQL via")
  Rel(kernel, duckdb, "Emits DuckDB SQL to")
  Rel(kernel, dbt, "Emits ref-mode SQL to")
```

---

## L3 — Component diagram (the kernel, the IR tables, the visitor extension)

The complex subsystem warranting L3 (5+ collaborating components): the typed
kernel, the discriminated-union validation boundary, the normalized tables, and
the kernel-visitor / report-extension renderer split (Decision 4B).

```mermaid
C4Component
  title Component Diagram — Derived-Relation Kernel + Renderer

  Container_Boundary(boundary, "View/Report application boundary") {

    Component(parse, "Boundary validator", "Pydantic discriminated unions", "Validates ProjectionColumn (by semantic_role) + Filter (by operator) BEFORE persistence; rejects malformed components")
    Component(depsvc, "Composition service", "Python", "Source-ref existence, no-cycle, no-mart-to-mart — shared by view + report use cases")

    ComponentDb(t_cols, "relation_columns", "table", "ProjectionColumn rows; ColumnRole entity/dimension/time/measure; position (presentation only)")
    ComponentDb(t_filt, "relation_filters", "table", "Filter rows; commutative (no sequence)")
    ComponentDb(t_join, "relation_joins", "table", "Join rows; sequence NOT NULL (declaration-ordered)")
    ComponentDb(t_grain, "relation_grain", "table", "Grain keys; set-like")
    ComponentDb(t_agg, "relation_aggregations", "table", "Measure→aggregation bindings; REPORT parent only")

    Component(kvis, "Kernel visitor", "Python + ibis", "sources -> join(by sequence) -> filter -> project; renders shared components to an ibis.Table")
    Component(rext, "Report extension", "Python + ibis", "Composes the kernel visitor, then applies group_by(grain).aggregate(measures)")
    Component(cat, "Render dispatch catalog", "Python", "One entry per component discriminator; build-time completeness check per active visitor")
  }

  System_Ext(ibis, "ibis -> to_sql(duckdb)", "Deterministic SQL emission (ADR-026)")

  Rel(parse, t_cols, "Writes validated ProjectionColumn rows to")
  Rel(parse, t_filt, "Writes validated Filter rows to")
  Rel(parse, t_join, "Writes ordered Join rows to")
  Rel(parse, t_grain, "Writes Grain keys to")
  Rel(parse, t_agg, "Writes Measure bindings to (report only)")
  Rel(parse, depsvc, "Delegates source-ref + mart-to-mart checks to")

  Rel(kvis, t_cols, "Reads projection columns from")
  Rel(kvis, t_filt, "Reads filters (as WHERE conjunction) from")
  Rel(kvis, t_join, "Reads joins in sequence order from")
  Rel(kvis, cat, "Dispatches per-component rendering through")
  Rel(rext, kvis, "Composes (kernel table first), then aggregates over")
  Rel(rext, t_grain, "Reads GROUP BY keys from")
  Rel(rext, t_agg, "Reads measure aggregations from")
  Rel(kvis, ibis, "Emits shared-component SQL via")
  Rel(rext, ibis, "Emits aggregate-over-grain SQL via")
```

---

## Reading notes (level discipline)

- **L2** shows containers (use cases, kernel+renderer, two datastores) and
  external systems (agent, Excel/M, DuckDB, dbt). It does not show the five
  component tables individually — that is L3 detail.
- **L3** opens the application boundary: the validation boundary (Decision 3),
  the five normalized tables (Decision 1C), and the kernel-visitor / report-
  extension split (Decision 4B). The report extension **composes** the kernel
  visitor (the "Report is a View plus one operator" finding, rendered as an edge,
  not a mode branch).
- The `relation_joins → sequence`-ordered read (Decision 2B) is the only
  order-bearing edge; every other component read is set-like.
- No edge reads compiled SQL back as authority — ibis is strictly terminal
  (ADR-026 hard invariant).
