# Report

## Bounded Context

Data Modeling

## Purpose

A Report represents the semantic layer over datasets and views, defining dimensions, measures, and entity relationships. Reports classify columns with semantic roles and types to enable analytical queries and aggregations.

## Identity

| Field | Type | Description |
|-------|------|-------------|
| `id` | `varchar(36)` | Primary key (UUID) |

## Attributes

| Attribute | Type | Required | Default | Constraints |
|-----------|------|----------|---------|-------------|
| `id` | varchar(36) | yes | generated | PK |
| `project_id` | varchar(36) | yes | — | FK → projects |
| `org_id` | varchar(36) | yes | — | FK (indexed); org-scoped |
| `name` | varchar(255) | yes | — | — |
| `description` | text | no | — | — |
| `sql_definition` | text | no | — | — |
| `source_refs` | json | no | — | — |
| `report_type` | varchar(20) | yes | — | `fact` or `dimension` |
| `domain` | varchar(100) | yes | `"Organization"` | — |
| `columns_metadata` | json | yes | — | Array of column metadata entries |
| `materialization` | varchar(20) | yes | `"view"` | `view`, `table`, `ephemeral`, `incremental` |
| `created_at` | datetime | yes | generated | — |
| `updated_at` | datetime | yes | generated | — |

## Invariants

1. **Report type constraint**
   > A Report SHALL have `report_type` of `"fact"` or `"dimension"`.

   **Enforced in:** `backend/app/models/report.py` — string field (no enum constraint in model; validated at schema layer)
   **Specified in:** `features/report-layer-chat-first.feature`

2. **No mart-to-mart dependencies**
   > Reports SHALL NOT reference other reports (no mart-to-mart dependencies).

   **Enforced in:** `backend/app/use_cases/report/create_report.py` — raises `InvalidReportReference`
   **Specified in:** `openspec/specs/report-column-metadata/spec.md` (implicit)

### Column Metadata Schema

Each entry in `columns_metadata` SHALL conform to:

| Field | Type | Required | Description |
|:------|:-----|:--------:|:------------|
| `name` | string | yes | Column name from source |
| `semantic_role` | enum | yes | `entity`, `dimension`, or `measure` |
| `semantic_type` | enum | yes | Depends on role (see table below) |
| `time_granularity` | enum | when type=`time` | `day`, `week`, `month`, `quarter`, `year` |

### Valid semantic_type by Role

| semantic_role | Valid semantic_type values |
|:-------------|:--------------------------|
| `entity` | `primary`, `foreign`, `unique` |
| `dimension` | `categorical`, `time` |
| `measure` | `sum`, `count`, `count_distinct`, `avg`, `min`, `max` |

**Enforced in:** `backend/app/use_cases/report/column_validation.py:9-50` — `validate_columns_metadata()`
**Specified in:** `openspec/specs/report-column-metadata/spec.md`

### Defaults

| Field | Default | Enforced in |
|:------|:--------|:------------|
| `domain` | `"Organization"` | `backend/app/models/report.py:44` |
| `materialization` | `"view"` | `backend/app/models/report.py:46` |

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| parent | Project | many-to-one | Report belongs to a project |

## Lifecycle

No explicit state machine. Entity is created and can be updated or deleted.

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `ReportNotFound` | 404 | Report ID doesn't exist |
| `InvalidReportReference` | 400 | Report references another report (mart-to-mart) |
| `InvalidColumnMetadata` | 400 | Column metadata fails validation |

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [View](view.md) — reports can be built on views
- [Dataset](dataset.md) — reports can be built on datasets
