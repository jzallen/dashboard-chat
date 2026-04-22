## Purpose

Describes the structured View domain model (`columns`, `joins`, `filters`, `grain`) that replaces raw `sql_definition` as the source of truth for view structure. It lets chat tools reason about and mutate view structure safely, with SQL derived from the model rather than hand-edited.

## Requirements

### Requirement: View domain model has structured column definitions

The `View` domain model SHALL include `columns: list[ViewColumn]`, `joins: list[ViewJoin]`, `filters: list[ViewFilter]`, and `grain: ViewGrain | None` as first-class fields, replacing raw `sql_definition` as the source of truth for view structure.

#### Scenario: ViewColumn has required fields

- **WHEN** a `ViewColumn` is constructed
- **THEN** it SHALL have: `name` (output column name), `source_ref` (dataset or view ID), `source_column` (original column name in source), `display_type` (one of the 10 display types), and `grain_role` (`Time` | `Dimension` | `Entity` | `Metric` | `None`)
- **AND** `alias` SHALL be an optional field (if set, `name` uses the alias value; otherwise `name` equals `source_column`)

#### Scenario: ViewJoin has left/right source and condition

- **WHEN** a `ViewJoin` is constructed
- **THEN** it SHALL have: `left_ref` (source ID), `left_column`, `right_ref` (source ID), `right_column`, `join_type` (default `INNER`)

#### Scenario: ViewFilter has column, operator, and value

- **WHEN** a `ViewFilter` is constructed
- **THEN** it SHALL have: `source_ref` (source ID), `column`, `operator` (one of: `=`, `!=`, `>`, `>=`, `<`, `<=`, `IN`, `NOT IN`, `IS NULL`, `IS NOT NULL`, `LIKE`, `NOT LIKE`), `value` (string or null for IS NULL / IS NOT NULL operators)

#### Scenario: ViewGrain specifies time column and optional dimensions

- **WHEN** a `ViewGrain` is constructed
- **THEN** it SHALL have: `time_column` (column name; must be cast as date/time/datetime), `dimensions: list[str]` (column names serving as grain dimensions)

---

### Requirement: Display type enumeration

The system SHALL support exactly 10 display types with defined backend SQL type mappings.

#### Scenario: All display types map to backend SQL types

- **WHEN** `ViewSQLGenerator` resolves a column's SQL type
- **THEN** the mapping SHALL be:
  | Display Type | Backend SQL Type |
  |-------------|-----------------|
  | text        | TEXT            |
  | category    | TEXT            |
  | id          | TEXT            |
  | serial      | INTEGER         |
  | integer     | INTEGER         |
  | decimal     | DECIMAL         |
  | boolean     | BOOLEAN         |
  | date        | DATE            |
  | time        | TIME            |
  | datetime    | TIMESTAMP       |

#### Scenario: Unknown display type is rejected

- **WHEN** a PATCH request contains a `display_type` value not in the enumeration
- **THEN** the backend SHALL return 422 Unprocessable Entity

---

### Requirement: ORM gains JSON columns via Alembic migration

The `ViewRecord` ORM model SHALL gain `columns`, `joins`, `filters`, and `grain` as JSON-typed columns, populated from the structured domain model.

#### Scenario: Migration adds nullable JSON columns with defaults

- **WHEN** the Alembic migration runs on an existing database
- **THEN** `view_records.columns` SHALL be added as a JSON column defaulting to `[]`
- **AND** `view_records.joins` SHALL be added as a JSON column defaulting to `[]`
- **AND** `view_records.filters` SHALL be added as a JSON column defaulting to `[]`
- **AND** `view_records.grain` SHALL be added as a nullable JSON column defaulting to `null`
- **AND** existing view records SHALL have empty arrays for columns, joins, filters

#### Scenario: JSON columns round-trip through SQLAlchemy

- **WHEN** a `ViewRecord` with structured columns is saved and then retrieved
- **THEN** the `columns` list order SHALL be preserved
- **AND** all `ViewColumn` fields SHALL be present with their original values

---

### Requirement: Grain role auto-assignment in update_view

The `update_view` use case SHALL re-derive `grain_role` for all columns whenever `columns` or `grain` is mutated in a PATCH request.

#### Scenario: Grain role is None when no grain is defined

- **WHEN** a view has no grain defined (`grain` is null)
- **THEN** all columns SHALL have `grain_role = None`

#### Scenario: Time column gets Time role

- **WHEN** grain is defined with `time_column = "order_date"`
- **AND** the view has a column named `"order_date"` with `display_type` of `date`, `time`, or `datetime`
- **THEN** that column SHALL have `grain_role = Time`

#### Scenario: Dimension columns get Dimension or Entity role

- **WHEN** grain is defined and a column is in `grain.dimensions`
- **AND** the column has `display_type` of `text`, `category`, or `serial`
- **THEN** the column SHALL have `grain_role = Dimension`
- **WHEN** the column has `display_type` of `id`
- **THEN** the column SHALL have `grain_role = Entity`

#### Scenario: Decimal and integer columns auto-assigned Metric

- **WHEN** grain is defined
- **AND** a column has `display_type` of `decimal` or `integer`
- **AND** the column is NOT the time column and NOT in `grain.dimensions`
- **THEN** the column SHALL have `grain_role = Metric`

#### Scenario: Text and boolean columns outside grain get no role

- **WHEN** grain is defined
- **AND** a column has `display_type` of `text` or `boolean`
- **AND** the column is NOT the time column and NOT in `grain.dimensions`
- **THEN** the column SHALL have `grain_role = None`

---

### Requirement: Views are org-scoped and project-scoped

The view CRUD endpoints SHALL enforce org-level and project-level access control consistent with other project resources.

#### Scenario: View access rejected for wrong org

- **WHEN** a user from org B requests a view belonging to a project in org A
- **THEN** the system SHALL return 403 Forbidden

#### Scenario: List views returns only project views

- **WHEN** the user lists views for a project
- **THEN** only views whose `project_id` matches the requested project SHALL be returned
