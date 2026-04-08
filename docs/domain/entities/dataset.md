# Dataset

## Bounded Context

Data Modeling

## Purpose

A Dataset represents a Parquet-backed data table with schema metadata and a pipeline of non-destructive transforms. It is the core analytical unit that users upload, query, and transform via natural language.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |
| `storage_path` | `text` | Computed unique path: `datasets/{project_id}/{dataset_id}/` |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `project_id` | varchar(36) | yes | — | FK → projects |
| `name` | varchar(255) | yes | — | — |
| `description` | text | no | — | — |
| `schema_config` | json | yes | — | Must contain `fields` dict |
| `partition_fields` | json | no | — | — |
| `column_profiles` | json | no | — | — |
| `format_context` | text | no | — | — |
| `storage_path` | text | yes | computed | Unique; pattern `datasets/{project_id}/{dataset_id}/` |
| `created_at` | datetime | yes | generated | — |
| `updated_at` | datetime | yes | generated | — |

## Invariants

1. **Schema required for queries**
   > A Dataset SHALL have a non-empty `schema_config` with a `fields` dict before any query can execute.

   **Enforced in:** `backend/app/models/dataset.py:212` — `_build_table_from_schema()` raises `ValueError("No data or schema available")`
   **Specified in:** Undocumented

2. **Storage path convention**
   > Dataset storage path SHALL follow the pattern `datasets/{project_id}/{dataset_id}/`.

   **Enforced in:** `backend/app/models/dataset.py:89` — `storage_path` computed property
   **Specified in:** Undocumented

3. **Non-destructive transforms**
   > All transforms are non-destructive. Raw Parquet files SHALL never be modified by transform operations.

   **Enforced in:** Architecture — transforms generate SQL via Ibis; Parquet files are read-only
   **Specified in:** `../../requirements/nfr-m3-non-destructive-exploration.md`

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| parent | Project | many-to-one | Dataset belongs to a project |
| children | Transform | one-to-many | Dataset has many transforms |

## Lifecycle

No explicit state machine. Entity is created and can be updated or deleted.

### Transform Pipeline

Transforms are applied in a strict three-stage pipeline. Within each stage, transforms are sorted by `created_at`.

| Stage | Order | Transform Types | Ibis Operation | Field Requirements |
|:-----:|:-----:|:----------------|:---------------|:-------------------|
| 1 | MUTATE | `clean`, `map` | `.mutate()` | `target_column` + `expression_config` |
| 2 | FILTER | `filter` | `.filter()` | `condition_json` |
| 3 | RENAME | `alias` | `.rename()` | `expression_config.alias_name` |

**Enforced in:** `backend/app/models/dataset.py:155-206` — `_build_table()` method
**Specified in:** `../dataset-lifecycle.md` (stages documented, ordering rule undocumented)

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `DatasetNotFound` | 404 | Dataset ID doesn't exist |
| `InvalidExpressionConfig` | 400 | Expression config fails validation |
| `ColumnTypeMismatch` | 422 | Transform target column has incompatible type |
| `PreviewNotSupported` | 400 | Preview requested on unsupported dataset state |

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [Dataset Lifecycle](../dataset-lifecycle.md)
- [Transform](transform.md) — child entity for non-destructive data transformations
