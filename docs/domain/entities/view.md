# View

## Bounded Context

Data Modeling

## Purpose

A View represents a composed SQL view over one or more datasets, with joins, filters, column selections, and grain definitions. Views support multiple materialization strategies and form a dependency graph that must remain acyclic.

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
| `columns` | json | no | — | Array of ViewColumn |
| `joins` | json | no | — | Array of ViewJoin |
| `filters` | json | no | — | Array of ViewFilter |
| `grain` | json | no | — | ViewGrain object |
| `materialization` | varchar(20) | yes | `ephemeral` | `ephemeral`, `view`, `table`, `incremental` |
| `created_at` | datetime | yes | generated | — |
| `updated_at` | datetime | yes | generated | — |

## Invariants

1. **ViewColumn required fields**
   > A ViewColumn SHALL have `name`, `source_ref`, `source_column`, and `display_type`. `grain_role` and `alias` are optional.

   **Enforced in:** `backend/app/models/view.py:33-63` — frozen dataclass constructors
   **Specified in:** Undocumented

2. **ViewJoin required fields**
   > A ViewJoin SHALL have `left_ref`, `left_column`, `right_ref`, `right_column`. `join_type` defaults to `"INNER"`. Valid join types: `INNER`, `LEFT`, `RIGHT`, `FULL`.

   **Enforced in:** `backend/app/models/view.py:33-63` — frozen dataclass constructors
   **Specified in:** Undocumented

3. **ViewFilter required fields**
   > A ViewFilter SHALL have `source_ref`, `column`, `operator`. `value` is optional (omitted for `IS NULL`/`IS NOT NULL`).

   **Enforced in:** `backend/app/models/view.py:33-63` — frozen dataclass constructors
   **Specified in:** Undocumented

4. **ViewGrain required fields**
   > A ViewGrain SHALL have `time_column` (required). `dimensions` is an optional list of column names.

   **Enforced in:** `backend/app/models/view.py:33-63` — frozen dataclass constructors
   **Specified in:** Undocumented

5. **Materialization default**
   > View materialization SHALL default to `"ephemeral"` and accept: `ephemeral`, `view`, `table`, `incremental`.

   **Enforced in:** `backend/app/models/view.py:102` — field default
   **Specified in:** `features/view-layer-chat-first.feature`

6. **No circular dependencies**
   > Views SHALL NOT create circular dependencies. A view cannot reference itself or create a reference cycle.

   **Enforced in:** `backend/app/use_cases/view/dependency_service.py` — raises `CircularDependency`
   **Specified in:** Undocumented

### DisplayType Enum

| Value | Description | Example Use |
|:------|:------------|:------------|
| `text` | Free-form string | Patient name, notes |
| `category` | Low-cardinality string | Status, department |
| `id` | Unique identifier | Primary key, UUID |
| `serial` | Auto-incrementing integer | Row number |
| `integer` | Whole number | Count, quantity |
| `decimal` | Floating-point number | Revenue, percentage |
| `boolean` | True/false | Active flag |
| `date` | Calendar date | Birth date |
| `time` | Time of day | Appointment time |
| `datetime` | Date + time | Created timestamp |

**Enforced in:** `backend/app/models/view.py:13-24` — `DisplayType(StrEnum)`

### GrainRole Enum

| Value | Description | When to Use |
|:------|:------------|:------------|
| `Time` | Time dimension column | The column used for time-series grouping |
| `Dimension` | Grouping dimension | Categorical columns for GROUP BY |
| `Entity` | Entity identifier | Primary/foreign keys linking entities |
| `Metric` | Numeric measure | Columns that will be aggregated |

**Enforced in:** `backend/app/models/view.py:26-31` — `GrainRole(StrEnum)`

## Relationships

| Relationship | Target | Cardinality | Description |
|-------------|--------|-------------|-------------|
| parent | Project | many-to-one | View belongs to a project |

## Lifecycle

No explicit state machine. Entity is created and can be updated or deleted. Views form a dependency graph that is validated on creation/update.

## Domain Exceptions

| Exception | HTTP Status | Trigger |
|-----------|-------------|---------|
| `ViewNotFound` | 404 | View ID doesn't exist |
| `InvalidSourceReference` | 400 | Source ref points to non-existent dataset/view |
| `CircularDependency` | 400 | View would create a circular reference |

## Related

- [Entity-Relationship Diagram](../erd.mermaid)
- [Dataset](dataset.md) — source data for view columns
- [Report](report.md) — reports can be built on views
