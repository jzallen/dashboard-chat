## Context

The platform currently supports a 2-layer dbt pipeline: source (raw Parquet files in S3) and staging (Datasets with transforms). The requirements call for two additional layers — intermediate (Views) and marts (Reports) — to enable joins, aggregations, and consumption-ready models with semantic metadata.

The existing data model uses domain objects (`Dataset`, `Transform`, `Project`) backed by ORM records (`DatasetRecord`, `TransformRecord`, `ProjectRecord`) in the metadata repository. Datasets own Transforms via a parent-child relationship. The dbt export use case (`export_dbt_project.py`) generates a zip with staging models only.

The requirements doc raises five open questions that this design resolves.

## Goals / Non-Goals

**Goals:**
- Add View and Report entities that integrate cleanly with existing Project → Dataset patterns
- Extend dbt export to produce a valid 4-layer dbt project
- Store column-level semantic metadata on Reports for future MetricFlow integration
- Keep the implementation incremental — Views can ship before Reports

**Non-Goals:**
- MetricFlow YAML generation (`semantic_models`, `metrics`) — metadata captured but not exported
- Query execution for Views/Reports — they are export-only SQL definitions initially
- Visualization or dashboarding
- Cross-project references
- Version history for SQL definitions

## Decisions

### D1: Separate tables, not a discriminator on Dataset

**Decision:** View and Report are new database tables (`views` and `reports`), not an extension of the `datasets` table with a `layer` discriminator.

**Rationale:**
- Dataset has domain-specific fields (`schema_config`, `partition_fields`, `storage_path`, `column_profiles`, `preview_rows`) that don't apply to Views/Reports
- Views/Reports have fields Datasets don't need (`sql_definition`, `materialization`, `source_refs`; Reports additionally have `report_type`, `domain`, `columns_metadata`)
- A discriminator would create a wide table with many nullable columns and confusing semantics
- Separate tables keep each entity's invariants clean and independently evolvable
- The dbt export already queries by entity type — separate tables make this natural

**Alternative rejected:** Single table with `layer` discriminator. Simpler migration but couples unrelated concerns and makes schema_config ambiguous.

### D2: Shared naming/serialization utilities, not a shared base class

**Decision:** View and Report domain models are standalone frozen dataclasses (like `Dataset`). They share utility functions (snake_case naming, serialization helpers) but do not inherit from a common `Model` base class.

**Rationale:**
- The domain objects are simple frozen dataclasses — inheritance adds complexity without benefit
- The three entities have different serialization shapes (Dataset has transforms, Report has columns_metadata)
- Shared behavior (snake_case naming, storage path patterns) is already extracted into utility functions (`_dbt/naming.py`)
- Duck typing is sufficient — all three have `id`, `name`, `project_id`, which is enough for catalog listing

**Alternative rejected:** Abstract `LayeredModel` base class. Adds a type hierarchy for ~3 shared fields and makes frozen dataclass composition awkward.

### D3: Source references as a JSON array on the entity, not a junction table

**Decision:** Each View and Report stores its source references as a JSON array field (`source_refs: list[dict]`) where each entry has `{"id": "<uuid>", "type": "dataset|view"}`.

**Rationale:**
- The dependency graph is shallow (typically 1-5 sources per model) and read-heavy
- A junction table adds CRUD complexity (separate repo methods, join queries) for minimal benefit at this scale
- JSON is sufficient for `{{ ref() }}` generation — we just need IDs and types
- Circular dependency detection can use a simple DFS on the in-memory graph at creation time
- Both SQLite and PostgreSQL handle JSON arrays well

**Trade-off:** Cannot use FK constraints to prevent orphaned references. Mitigation: validate references exist at creation/update time in the use case layer.

**Alternative rejected:** `model_dependencies` junction table with `(source_id, source_type, target_id, target_type)`. Cleaner relational design but over-engineered for the current scale and usage pattern.

### D4: Column metadata as a JSON field on Report, not a separate table

**Decision:** Report column metadata is stored as a JSON field `columns_metadata: list[dict]` on the `reports` table. Each dict contains `{name, semantic_role, semantic_type, description?, expr?, time_granularity?}`.

**Rationale:**
- Column metadata is always read/written as a unit with the Report — no independent column CRUD
- The metadata is export-oriented (generates `schema.yml`) and not queried relationally
- JSON keeps the schema flexible for future MetricFlow fields without migrations
- Matches the pattern of `schema_config` on Dataset (JSON blob of column info)

**Alternative rejected:** `report_columns` table with FK to `reports`. Adds a table, repository methods, and join queries for data that's always loaded as a unit.

### D5: SQL definition is free-form text, validated at export

**Decision:** View and Report SQL definitions are stored as free-form text (`sql_definition: str`). Layer-specific operation rules are enforced in the chat AI's system prompt, not at the storage layer.

**Rationale:**
- The AI generates SQL constrained by layer-specific prompts — this is the primary guardrail
- Validating SQL against an operation allowlist at storage time requires parsing SQL, which is fragile and adds complexity
- Users may need to manually edit AI-generated SQL (e.g., fix a column name)
- The dbt export just emits the SQL as-is — it doesn't need to understand the operations
- Future: a lint/validation step at export time can warn about layer violations without blocking saves

**Alternative rejected:** Structured operation model (like transforms) instead of free-form SQL. Too restrictive for the intermediate/mart layers where SQL complexity varies widely.

### D6: Materialization as a simple enum field

**Decision:** Each View and Report has a `materialization` field (`Literal["ephemeral", "view", "table", "incremental"]`) with defaults of `"ephemeral"` for Views and `"view"` for Reports.

**Rationale:** Materialization maps 1:1 to dbt's `{{ config(materialized='...') }}` block. No additional configuration is needed initially (incremental strategy, unique_key, etc. are future concerns).

### D7: Incremental shipping — Views first, then Reports

**Decision:** Ship Views (intermediate layer) in phase 1, Reports (mart layer) in phase 2.

**Rationale:**
- Views add immediate value (JOINs, aggregations) without column metadata complexity
- Views are prerequisite for Reports (Reports reference Views)
- Splitting reduces risk and allows validation of the core pattern (new entity + dbt export) before adding semantic metadata
- Phase 2 (Reports) builds on the same patterns established in phase 1

### D8: ORM records follow existing pattern

**Decision:** New `ViewRecord` and `ReportRecord` ORM classes in `backend/app/repositories/metadata/`, following the same pattern as `DatasetRecord`. New Alembic migration adds `views` and `reports` tables.

**Table schema — `views`:**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | String(36) | PK, UUIDv7 |
| `project_id` | String(36) | FK → projects.id, NOT NULL |
| `org_id` | String(36) | NOT NULL, indexed |
| `name` | String(255) | NOT NULL |
| `description` | Text | nullable |
| `sql_definition` | Text | NOT NULL |
| `source_refs` | JSON | NOT NULL, default `[]` |
| `materialization` | String(20) | NOT NULL, default `"ephemeral"` |
| `created_at` | DateTime | NOT NULL |
| `updated_at` | DateTime | NOT NULL |

**Table schema — `reports`:**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | String(36) | PK, UUIDv7 |
| `project_id` | String(36) | FK → projects.id, NOT NULL |
| `org_id` | String(36) | NOT NULL, indexed |
| `name` | String(255) | NOT NULL |
| `description` | Text | nullable |
| `sql_definition` | Text | NOT NULL |
| `source_refs` | JSON | NOT NULL, default `[]` |
| `report_type` | String(20) | NOT NULL (`"fact"` or `"dimension"`) |
| `domain` | String(100) | NOT NULL, default `"Organization"` |
| `columns_metadata` | JSON | NOT NULL, default `[]` |
| `materialization` | String(20) | NOT NULL, default `"view"` |
| `created_at` | DateTime | NOT NULL |
| `updated_at` | DateTime | NOT NULL |

### D9: dbt export structure

The export use case expands to query Views and Reports alongside Datasets, then generates:

```
models/
  staging/
    sources.yml          # unchanged
    stg_*.sql            # unchanged
  intermediate/
    int_*.sql            # NEW — View SQL wrapped in config block
  marts/
    {domain}/            # NEW — subdirectory per domain (snake_cased)
      fct_*.sql          # NEW — fact Report SQL
      dim_*.sql          # NEW — dimension Report SQL
  schema.yml             # MODIFIED — adds mart model entries with column metadata
```

SQL files include a `{{ config(materialized='...') }}` block and use `{{ ref('...') }}` for source references. The export resolves `source_refs` IDs to the correct `ref()` names.

## Risks / Trade-offs

**[JSON source_refs can become stale]** → Validate references exist at View/Report create/update time. If a referenced Dataset is deleted, the export will fail with a clear error pointing to the broken reference.

**[Free-form SQL can violate layer rules]** → The AI prompt is the primary guardrail. A future "lint at export" step can warn without blocking. This is acceptable because the platform's value is AI-guided SQL generation, not a SQL validator.

**[No FK enforcement on source_refs]** → Application-level validation at create/update. Acceptable trade-off for JSON simplicity at current scale.

**[Two-phase delivery delays Reports]** → Views alone provide significant value (JOINs, aggregations, multi-source models). Reports build on the same infrastructure with additive complexity. The phases share ~70% of the work (new entity pattern, export extension, CRUD).

**[Column metadata schema may evolve]** → JSON field allows schema evolution without migrations. MetricFlow-specific fields can be added to the JSON structure later.
