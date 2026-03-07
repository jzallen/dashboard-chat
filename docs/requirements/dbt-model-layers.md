# dbt Model Layers: Intermediate & Mart Support — Requirements

**Status:** Draft
**Author:** Business Analyst
**Audience:** Solutions Architect, Development Team
**Feature Spec:** `features/dbt-model-layers.feature`

## Problem Statement

The platform currently supports only two dbt layers: **source** (raw Parquet files) and **staging** (Datasets with cleaning/filter/alias transforms). This limits users to normalization-level operations. Users cannot build derived models that join, reshape, or aggregate data — the standard intermediate and mart layers in a dbt project.

To support a complete analytics pipeline and eventual MetricFlow integration, we need two additional model layers with distinct SQL operation sets and business rules.

## Business Goals

1. **Complete dbt pipeline** — Users can export a full 4-layer dbt project (source → staging → intermediate → marts) from the platform
2. **Guided SQL generation** — Each layer constrains what SQL operations the AI can generate, preventing misuse (e.g., aggregations in staging models)
3. **MetricFlow readiness** — Reports capture column-level semantic metadata (dimension, measure, entity) needed for future MetricFlow integration
4. **Intuitive naming** — Each layer has a user-friendly domain name that non-technical users understand

## Domain Naming

The target audience is low-code data professionals and product owners who spend more time in Excel than an IDE. Domain names must be immediately meaningful to this audience, not to dbt engineers. dbt-specific terminology (`stg_`, `int_`, `fct_`, `dim_`) is used only in the generated export — never in the platform UI.

Each dbt layer maps to a platform-specific term:

| dbt Layer | Platform Name | dbt Prefix | Rationale |
|-----------|--------------|------------|-----------|
| Source | (raw file) | — | Parquet files in S3, referenced via `{{ source() }}` |
| Staging | **Dataset** | `stg_` | Already established. Normalization: rename, cast, clean, filter |
| Intermediate | **View** | `int_` | Intuitive to Excel users — a "view" of your data, shaped for a specific purpose. The SQL VIEW collision is acceptable because the platform's audience rarely interacts with SQL directly |
| Mart | **Report** | `fct_` / `dim_` | The final, consumable output. "Report" is the word an Excel user reaches for when describing summarized, ready-to-share data |

**Why "View":** While "View" collides with SQL VIEW in technical contexts, the target audience thinks in spreadsheets, not databases. A "view" of data is natural language for "a way of looking at my data" — which is exactly what intermediate models are. The platform abstracts SQL away; users never see `CREATE VIEW`.

**Why "Report":** "Report" is the most intuitive term for business users describing consumption-ready output. In Excel, a "report" is a formatted summary you share with stakeholders — precisely the role of the mart layer. The BI tool collision (Power BI, Tableau use "report" for visualizations) is acceptable because this platform does not have a visualization layer.

### Reports and Domains

Reports are organized by **domain** — a business grouping that corresponds to dbt's mart subdirectory convention. Each Report belongs to a domain, which defaults to `"Organization"` but can be changed to reflect the business area (e.g., `"Finance"`, `"Marketing"`, `"Operations"`).

In dbt export, the domain maps to a subdirectory under `marts/`:
```
models/marts/
  finance/
    fct_invoices.sql
    dim_accounts.sql
  marketing/
    fct_campaigns.sql
    dim_channels.sql
```

### Alternative rejected: Dataset → Model → Mart
"Model" and "Mart" are precise in the dbt ecosystem but opaque to the target audience. A product owner should not need to learn data engineering jargon to use the platform. The dbt mapping is an export concern, not a user-facing concern.

## Layer Definitions & SQL Operation Rules

### Layer 1: Dataset (Staging) — No changes

**Purpose:** 1:1 normalization of a source file. One source → one Dataset.

**Allowed SQL operations:**
- Column renaming (alias transforms)
- Type casting
- String cleaning (trim, case conversion)
- NULL handling (COALESCE/fill_null)
- Value mapping (CASE WHEN for code → label)
- Row filtering (WHERE)

**Prohibited:** JOINs, GROUP BY, aggregate functions, window functions (beyond dedup), subqueries.

**Grain rule:** Must match source grain exactly.

### Layer 2: View (Intermediate)

**Purpose:** Purpose-built transformation steps that reshape, combine, or restructure staging data. Views exist to serve Reports — they are internal building blocks, not exposed to end users or BI tools.

**Allowed SQL operations:**
- Column aliasing / renaming
- Column selection (choosing a subset of columns from inputs)
- JOINs across Datasets or other Views
- Aggregations with GROUP BY (SUM, COUNT, AVG, MIN, MAX)
- Window functions (LAG, LEAD, ROW_NUMBER, running totals)
- Row filtering (WHERE, HAVING)
- CASE WHEN expressions (business logic derivation)
- UNION / UNION ALL (combining datasets)
- Subqueries and CTEs

**Prohibited:** MetricFlow semantic annotations (those belong in Reports only).

**Grain rule:** May change grain from source (e.g., order-line → order-level aggregation).

**dbt naming convention:** `int_{entity}_{verb}.sql` — the verb describes the transformation (e.g., `int_orders_aggregated_to_customer`, `int_payments_joined_to_orders`).

**Materialization default:** Ephemeral (CTE inlined into downstream) or view in a hidden schema.

### Layer 3: Report (Mart)

**Purpose:** Business-defined entities ready for consumption. Reports are the only layer exposed to BI tools, analysts, and MetricFlow. Reports should be as **denormalized as possible** — joining dimension attributes directly onto facts — so the semantic layer can model them without requiring additional joins.

**Allowed SQL operations:**
- All operations from the View layer
- Final denormalization (joining dimension attributes onto facts)
- Metric calculations (ratios, percentages from pre-computed columns)
- Lite aggregations (the heavy lifting should already be done in Views)

**Design principle:** Push complexity into Views so that Reports remain wide, flat, and easy to model in MetricFlow. A well-built Report should need minimal joins downstream — it is the "one big table" for its domain.

**Grain rule:** Must have a clear, business-meaningful grain (one row per order, one row per customer).

**Report type:** Each Report is classified as either:
- **Fact** (`fct_{entity}.sql` in dbt export) — Event/transaction tables (tall, narrow). Examples: `fct_orders`, `fct_page_views`
- **Dimension** (`dim_{entity}.sql` in dbt export) — Entity/descriptor tables (wide, short). Examples: `dim_customers`, `dim_products`

**Domain:** Each Report belongs to a domain (business area grouping). Defaults to `"Organization"`. Examples: `"Finance"`, `"Marketing"`, `"Operations"`. In dbt export, the domain maps to a subdirectory under `marts/`.

**Materialization default:** View initially, table or incremental as data grows.

## Column-Level Metadata (MetricFlow Readiness)

The data catalog currently does not track columns. To support Report-level aggregation rules and future MetricFlow integration, we need column metadata on **Reports only**.

### Required Column Metadata Fields

| Field | Type | Required? | Description |
|-------|------|-----------|-------------|
| `name` | string | Yes | Physical column name |
| `semantic_role` | enum | Yes | `entity`, `dimension`, or `measure` |
| `semantic_type` | enum | Yes | Sub-classification (see below) |
| `description` | string | No | Human-readable label |
| `expr` | string | No | SQL expression if different from physical column |

### Semantic Type Values by Role

**Entity types** (join keys — how models relate to each other):
- `primary` — The table's own identity (one per row, no nulls)
- `foreign` — Reference to another model's primary entity
- `unique` — One per row but may have nulls (subset key)

**Dimension types** (columns you group by / filter on):
- `categorical` — Non-temporal grouping (region, status, category)
- `time` — Date/timestamp for time-series analysis. Requires `time_granularity` (day/week/month/quarter/year)

**Measure types** (numeric columns with aggregation):
- `sum`, `count`, `count_distinct`, `avg`, `min`, `max`

### Model-Level Metadata

| Field | Type | Required? | Description |
|-------|------|-----------|-------------|
| `report_type` | enum | Yes | `fact` or `dimension` |
| `primary_time_dimension` | string | Conditional | Required if model has measures. Column name of the default time dimension for aggregation |

### Why Column Metadata on Reports Only

- **Datasets** have `schema_config` with type info — sufficient for staging
- **Views** are internal building blocks — semantic annotations add noise
- **Reports** are the consumption layer — MetricFlow semantic models map 1:1 to Reports

This keeps complexity proportional: staging = types only, intermediate = no metadata overhead, marts = full semantic metadata.

## Functional Requirements

### FR-1: View (Intermediate) CRUD

- Users can create a View within a project
- Each View references one or more input Datasets or other Views as sources
- Views have a name, optional description, and a SQL definition
- The AI generates View SQL constrained to the intermediate operation allowlist
- Views are org-scoped via their parent project

### FR-2: Report (Mart) CRUD

- Users can create a Report within a project
- Each Report references one or more Views or Datasets as sources
- Reports have a name, optional description, SQL definition, report_type (fact/dimension), and domain
- Reports include column-level semantic metadata
- The AI generates Report SQL constrained to the mart operation allowlist
- Reports are org-scoped via their parent project

### FR-3: SQL Generation Guardrails

- The chat AI must respect layer-specific SQL operation rules when generating SQL
- If a user asks for an operation not allowed at the current layer (e.g., "aggregate by customer" on a Dataset), the AI should:
  1. Explain that aggregation belongs in a View or Report
  2. Offer to create the appropriate type
- The system prompt includes layer-specific operation allowlists

### FR-4: dbt Export — Multi-Layer

When exporting a project as a dbt project:

- **Directory structure:**
  ```
  models/
    staging/
      sources.yml
      stg_*.sql
    intermediate/
      int_*.sql
    marts/
      {domain}/          # e.g., organization/, finance/, marketing/
        fct_*.sql
        dim_*.sql
    schema.yml
  ```
- Staging models generate SQL exactly as they do today (no change)
- Intermediate models (Views) export with `int_` prefix and reference staging models via `{{ ref('stg_...') }}`
- Mart models (Reports) export with `fct_`/`dim_` prefix and reference intermediate models via `{{ ref('int_...') }}`
- Reports are grouped into subdirectories by their domain (snake_cased)
- `schema.yml` includes semantic metadata for mart columns (mapped to MetricFlow-compatible format)
- DAG dependencies are respected: staging → intermediate → marts (no reverse references)

### FR-5: Column Metadata Capture for Reports

- When creating or editing a Report, users can annotate columns with semantic roles
- The AI can suggest semantic roles based on column names and types (e.g., `_id` suffix → entity, `_at`/`_date` suffix → time dimension, numeric columns → measure candidates)
- Column metadata is stored as part of the Report
- Column metadata is optional — Reports work without it, but dbt export generates richer schema.yml when metadata is present

### FR-6: Lineage / Dependency Tracking

- Each View and Report tracks its source references (which Datasets/Views it depends on)
- The export generates correct `{{ ref() }}` calls based on these dependencies
- Circular dependencies are prevented at creation time

### FR-7: Materialization Configuration

- Each View and Report has a configurable materialization strategy
- Defaults: View = `ephemeral`, Report = `view`
- Options: `ephemeral`, `view`, `table`, `incremental`
- Materialization is included in the generated dbt model config block

## Non-Functional Requirements

### NFR-1: Backward Compatibility
Existing Dataset (staging) behavior is unchanged. Current dbt exports continue to work. The new layers are additive.

### NFR-2: Multi-tenancy
Views and Reports are scoped by project → org_id, following the same pattern as Datasets.

### NFR-3: Data Catalog Integration
Views and Reports appear in the project's data catalog alongside Datasets, with clear visual distinction of their layer type.

### NFR-4: Chat Integration
Users can interact with Views and Reports through the same chat interface used for Datasets. The AI knows which layer it's operating on and constrains operations accordingly.

### NFR-5: Context Awareness UX
The chat interface must make the current operating context visible at all times, similar to how code editors (Claude Code, GitHub Copilot) display the active file name. This has two components:

1. **Persistent context indicator** — A visible badge or breadcrumb in the chat panel showing the layer and model currently in context (e.g., `Dataset / orders`, `View / orders_enriched`, `Report / fct_orders`). This updates when the user navigates between models or when the AI switches context.

2. **AI context announcement** — When the AI makes changes, it must state which model and layer it is targeting before describing the operation. When the AI switches context (e.g., from a Dataset to a new Model), it must explicitly announce the switch. This prevents confusion when the user has multiple models open or when the AI suggests creating a new layer.

## Out of Scope

- **MetricFlow YAML generation** — We capture the metadata needed but do not generate `semantic_models` or `metrics` YAML (future feature)
- **Query execution for Views/Reports** — Views and Reports define SQL but do not execute against the data lake in this iteration. They are export-only constructs initially
- **Visualization / dashboarding** — No BI layer
- **Version history** — No version history for View/Report SQL definitions (future feature)
- **Cross-project references** — Views/Reports cannot reference Datasets from other projects

## Open Questions for Solutions Architect

1. **Shared interface** — Dataset, View, and Report are all fundamentally SQL definitions with different business rules. Consider whether they should share a common interface or base type, with layer-specific behavior enforced via the business rule constraints rather than separate implementations. This could simplify CRUD, the data catalog, and the chat integration while keeping the SQL generation guardrails distinct per layer.

2. **Storage model** — Should Views and Reports be new database tables, or extend the existing Dataset/Transform model with a `layer` discriminator? Separate tables are cleaner but require new CRUD. A discriminator is simpler but conflates semantics. The shared interface question (above) informs this choice.

3. **SQL editing UX** — Should View/Report SQL be fully user-editable (free-form SQL editor) or constrained to AI-generated-only with transform-like structured operations? Free-form is more powerful but harder to validate against layer rules.

4. **Column metadata storage** — Should column semantic metadata live in the existing `schema_config` JSON (extending it), or in a separate `columns` table/JSON field? Extending schema_config is simpler but mixes platform types with semantic roles.

5. **Dependency graph persistence** — How should source references (View → Dataset, Report → View) be stored? Foreign keys in a junction table? JSON array of referenced IDs? This affects export ordering and circular dependency detection.

6. **Incremental adoption** — Should we ship Views + Reports together, or Views first? Views alone add value (joins, aggregations) without requiring column metadata complexity.
