## Why

The platform only supports two dbt layers: source (raw Parquet) and staging (Datasets with cleaning/filter/alias transforms). Users cannot build derived models that join, reshape, or aggregate data — the standard intermediate and mart layers in a dbt project. This blocks complete analytics pipelines and future MetricFlow integration.

## What Changes

- **Add View (intermediate layer) CRUD** — New entity for purpose-built transformations (JOINs, aggregations, window functions) that reshape staging data. Views reference Datasets or other Views as sources.
- **Add Report (mart layer) CRUD** — New entity for consumption-ready business models (facts and dimensions). Reports include column-level semantic metadata (entity/dimension/measure roles) for MetricFlow readiness.
- **Add SQL generation guardrails per layer** — Chat AI constrains generated SQL to layer-specific operation allowlists. Prohibited operations trigger guidance to the correct layer.
- **Extend dbt export to 4 layers** — **BREAKING** to export output structure: adds `models/intermediate/` and `models/marts/{domain}/` directories with `int_`, `fct_`, `dim_` prefixed models, `{{ ref() }}` dependencies, and semantic metadata in `schema.yml`.
- **Add dependency tracking** — Views and Reports track source references for correct `{{ ref() }}` generation and circular dependency prevention.
- **Add materialization configuration** — Each View and Report has configurable materialization (ephemeral, view, table, incremental).
- **Add context awareness to chat** — Persistent context indicator showing active model/layer, and AI context announcements when switching between models.

## Capabilities

### New Capabilities
- `view-intermediate-layer`: CRUD for View entities (intermediate dbt layer) — creation, editing, source references, SQL definition, materialization config. Org-scoped via parent project.
- `report-mart-layer`: CRUD for Report entities (mart dbt layer) — creation, editing, report type (fact/dimension), domain grouping, column-level semantic metadata, materialization config. Org-scoped via parent project.
- `model-dependency-tracking`: Lineage tracking for Views and Reports — source reference storage, `{{ ref() }}` resolution, circular dependency prevention, DAG ordering for export.
- `layer-sql-guardrails`: Per-layer SQL operation allowlists enforced in chat AI system prompts. Guides users to the correct layer when requesting out-of-scope operations.
- `report-column-metadata`: Column-level semantic annotations on Reports — semantic role (entity/dimension/measure), semantic type sub-classification, optional descriptions and expressions. MetricFlow-ready schema.

### Modified Capabilities
- `dbt-project-generation`: Export structure expands from staging-only to 4-layer (staging, intermediate, marts/{domain}). Adds `int_`, `fct_`, `dim_` prefixed models with `{{ ref() }}` cross-references and semantic metadata in `schema.yml`.
- `dbt-export-api`: No endpoint signature change, but response zip contents expand to include intermediate and mart model files.

## Impact

### Backend
- **New models**: View and Report SQLAlchemy models (or extended Dataset model with layer discriminator — architect decision)
- **New repositories**: CRUD for Views and Reports, dependency graph queries
- **New use cases**: `view/` and `report/` domain modules following existing decorator patterns
- **New routers/controllers**: REST endpoints for View and Report CRUD
- **Modified use cases**: `export_dbt_project.py` expands to generate intermediate and mart layers
- **Migrations**: Alembic migration for new tables/columns

### Frontend
- **New UI components**: View and Report editors, layer selector, context indicator badge
- **Modified components**: SideNav (show Views/Reports alongside Datasets), data catalog (layer type distinction), chat panel (context awareness)
- **New query hooks**: TanStack Query keys and mutations for View/Report CRUD

### Worker / Shared
- **Modified prompts**: Layer-specific system prompts with operation allowlists
- **Modified tool definitions**: Tools aware of current layer context

### Infrastructure
- No new services or infrastructure dependencies
- Multi-tenancy enforced via existing project → org_id scoping pattern
