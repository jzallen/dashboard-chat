## Purpose

Describes the View entity in the intermediate layer — a dbt intermediate model that reshapes, combines, or restructures staging data within a project. It defines the REST surface for View CRUD and the multi-tenancy and materialization contracts Views share with Reports.

## Requirements

### Requirement: View Entity CRUD

The system SHALL support creating, reading, updating, and deleting View entities within a project. A View represents an intermediate dbt model that reshapes, combines, or restructures staging data.

- The system SHALL expose REST endpoints for View CRUD under `/api/projects/{project_id}/views`.
- Each View SHALL have: `id` (UUIDv7), `project_id`, `org_id`, `name`, `description` (optional), `sql_definition`, `source_refs`, `materialization`, `created_at`, `updated_at`.
- Views SHALL be scoped by `org_id` via their parent project, following the same multi-tenancy pattern as Datasets.
- The `sql_definition` field SHALL store the View's SQL as free-form text.
- The `materialization` field SHALL default to `"ephemeral"` and accept values: `"ephemeral"`, `"view"`, `"table"`, `"incremental"`.

#### Scenario: Create a View within a project

- **WHEN** an authenticated user sends POST to `/api/projects/{project_id}/views` with `name: "Orders Enriched"`, `sql_definition: "SELECT o.*, c.name..."`, and `source_refs: [{"id": "ds-1", "type": "dataset"}, {"id": "ds-2", "type": "dataset"}]`
- **THEN** the system SHALL create a View record with a UUIDv7 `id`, the provided fields, `org_id` matching the project's `org_id`, and `materialization` defaulting to `"ephemeral"`
- **THEN** the response SHALL return the created View with status 201

#### Scenario: List Views in a project

- **WHEN** an authenticated user sends GET to `/api/projects/{project_id}/views`
- **THEN** the system SHALL return all Views belonging to the project and matching the user's `org_id`
- **THEN** each View in the response SHALL include `id`, `name`, `description`, `materialization`, `created_at`, and `updated_at`

#### Scenario: Update a View's SQL definition

- **WHEN** an authenticated user sends PATCH to `/api/projects/{project_id}/views/{view_id}` with `sql_definition: "SELECT o.*, c.name, p.amount..."`
- **THEN** the system SHALL update the View's `sql_definition` and `updated_at` timestamp
- **THEN** the response SHALL return the updated View

#### Scenario: Delete a View

- **WHEN** an authenticated user sends DELETE to `/api/projects/{project_id}/views/{view_id}`
- **THEN** the system SHALL delete the View record
- **THEN** the response SHALL return status 204

#### Scenario: Unauthorized access to another org's Views

- **WHEN** a user with `org_id = "org-1"` requests Views in a project with `org_id = "org-2"`
- **THEN** the system SHALL return 403 Forbidden

---

### Requirement: View Domain Model

The system SHALL provide a `View` domain model as a frozen dataclass, following the same pattern as the `Dataset` domain model.

- The `View` domain model SHALL have fields: `id`, `project_id`, `org_id`, `name`, `description`, `sql_definition`, `source_refs`, `materialization`, `created_at`, `updated_at`.
- The `View` domain model SHALL provide a `from_record` class method to convert from ORM records.
- The `View` domain model SHALL provide a `serialize` method for HTTP response serialization.
- The `source_refs` field SHALL be a list of dicts, each with `id` (str) and `type` (`"dataset"` or `"view"`).

#### Scenario: Create View domain object from ORM record

- **WHEN** a `ViewRecord` ORM object exists with all fields populated
- **THEN** `View.from_record(record)` SHALL return a `View` domain object with matching field values

#### Scenario: Serialize View to JSON

- **WHEN** a `View` domain object is serialized via `serialize()`
- **THEN** the result SHALL be a dict containing all fields with `created_at` and `updated_at` as ISO strings

---

### Requirement: View Database Schema

The system SHALL store Views in a `views` table with appropriate columns, foreign keys, and indexes.

- The `views` table SHALL have columns: `id` (PK, String(36)), `project_id` (FK → projects.id, NOT NULL), `org_id` (String(36), NOT NULL), `name` (String(255), NOT NULL), `description` (Text, nullable), `sql_definition` (Text, NOT NULL), `source_refs` (JSON, NOT NULL, default `[]`), `materialization` (String(20), NOT NULL, default `"ephemeral"`), `created_at` (DateTime, NOT NULL), `updated_at` (DateTime, NOT NULL).
- The table SHALL have an index on `org_id` for multi-tenant queries.
- The table SHALL have an index on `project_id` for project-scoped queries.
- The migration SHALL be created via Alembic and work with both SQLite and PostgreSQL.

#### Scenario: Migration creates views table

- **WHEN** the Alembic migration runs on a fresh database
- **THEN** the `views` table SHALL exist with all specified columns and constraints
- **THEN** the `project_id` foreign key SHALL reference `projects.id`

---

### Requirement: View dbt Export

The system SHALL generate intermediate model SQL files for Views during dbt project export.

- Each View SHALL export as `models/intermediate/int_{snake_case_name}.sql`.
- The exported SQL SHALL include a `{{ config(materialized='{materialization}') }}` block at the top.
- Source references to Datasets SHALL use `{{ ref('stg_{dataset_snake_name}') }}`.
- Source references to other Views SHALL use `{{ ref('int_{view_snake_name}') }}`.
- The View's `sql_definition` SHALL be emitted below the config block.
- View names SHALL follow the same snake_case deduplication logic as Datasets.

#### Scenario: Export a View referencing two Datasets

- **WHEN** a project has a View named "Orders Enriched" with `materialization: "ephemeral"` and `source_refs` referencing Datasets "Orders" and "Customers"
- **THEN** the export SHALL produce `models/intermediate/int_orders_enriched.sql`
- **THEN** the file SHALL begin with `{{ config(materialized='ephemeral') }}`
- **THEN** the SQL SHALL contain `{{ ref('stg_orders') }}` and `{{ ref('stg_customers') }}`

#### Scenario: Export a View referencing another View

- **WHEN** a View "Customer Lifetime Value" references View "Orders Enriched"
- **THEN** the exported SQL SHALL contain `{{ ref('int_orders_enriched') }}`

#### Scenario: View with table materialization

- **WHEN** a View has `materialization: "table"`
- **THEN** the config block SHALL be `{{ config(materialized='table') }}`
