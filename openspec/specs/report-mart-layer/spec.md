## Purpose

Describes the Report entity in the mart layer — a consumption-ready fact or dimension dbt model scoped to a project. It defines the REST surface for Report CRUD, the enum constraints on `report_type` / `domain` / `materialization`, and the multi-tenancy contract that scopes Reports by `org_id`.

## Requirements

### Requirement: Report Entity CRUD

The system SHALL support creating, reading, updating, and deleting Report entities within a project. A Report represents a mart-layer dbt model — a consumption-ready business entity (fact or dimension).

- The system SHALL expose REST endpoints for Report CRUD under `/api/projects/{project_id}/reports`.
- Each Report SHALL have: `id` (UUIDv7), `project_id`, `org_id`, `name`, `description` (optional), `sql_definition`, `source_refs`, `report_type`, `domain`, `columns_metadata`, `materialization`, `created_at`, `updated_at`.
- Reports SHALL be scoped by `org_id` via their parent project.
- The `report_type` field SHALL accept values: `"fact"` or `"dimension"`.
- The `domain` field SHALL default to `"Organization"`.
- The `materialization` field SHALL default to `"view"` and accept values: `"ephemeral"`, `"view"`, `"table"`, `"incremental"`.

#### Scenario: Create a fact Report

- **WHEN** an authenticated user sends POST to `/api/projects/{project_id}/reports` with `name: "Orders"`, `report_type: "fact"`, `domain: "Finance"`, `sql_definition: "SELECT ..."`, and `source_refs: [{"id": "view-1", "type": "view"}]`
- **THEN** the system SHALL create a Report with `report_type = "fact"`, `domain = "Finance"`, and `materialization` defaulting to `"view"`
- **THEN** the response SHALL return the created Report with status 201

#### Scenario: Create a dimension Report with default domain

- **WHEN** an authenticated user creates a Report without specifying `domain`
- **THEN** the Report's `domain` SHALL default to `"Organization"`

#### Scenario: List Reports in a project

- **WHEN** an authenticated user sends GET to `/api/projects/{project_id}/reports`
- **THEN** the system SHALL return all Reports belonging to the project and matching the user's `org_id`

#### Scenario: Update a Report's domain

- **WHEN** an authenticated user sends PATCH to `/api/projects/{project_id}/reports/{report_id}` with `domain: "Marketing"`
- **THEN** the system SHALL update the Report's `domain` and `updated_at`

#### Scenario: Delete a Report

- **WHEN** an authenticated user sends DELETE to `/api/projects/{project_id}/reports/{report_id}`
- **THEN** the system SHALL delete the Report record and return status 204

---

### Requirement: Report Domain Model

The system SHALL provide a `Report` domain model as a frozen dataclass.

- The `Report` domain model SHALL have fields: `id`, `project_id`, `org_id`, `name`, `description`, `sql_definition`, `source_refs`, `report_type`, `domain`, `columns_metadata`, `materialization`, `created_at`, `updated_at`.
- The `report_type` field SHALL be `Literal["fact", "dimension"]`.
- The `domain` field SHALL default to `"Organization"`.
- The `columns_metadata` field SHALL be a list of dicts (see `report-column-metadata` spec).
- The model SHALL provide `from_record` and `serialize` methods following existing patterns.

#### Scenario: Serialize Report with columns metadata

- **WHEN** a Report with `columns_metadata` containing 3 column entries is serialized
- **THEN** the serialized dict SHALL include all column entries in `columns_metadata`

---

### Requirement: Report Database Schema

The system SHALL store Reports in a `reports` table.

- The `reports` table SHALL have columns: `id` (PK, String(36)), `project_id` (FK → projects.id, NOT NULL), `org_id` (String(36), NOT NULL), `name` (String(255), NOT NULL), `description` (Text, nullable), `sql_definition` (Text, NOT NULL), `source_refs` (JSON, NOT NULL, default `[]`), `report_type` (String(20), NOT NULL), `domain` (String(100), NOT NULL, default `"Organization"`), `columns_metadata` (JSON, NOT NULL, default `[]`), `materialization` (String(20), NOT NULL, default `"view"`), `created_at` (DateTime, NOT NULL), `updated_at` (DateTime, NOT NULL).
- The table SHALL have indexes on `org_id` and `project_id`.

#### Scenario: Migration creates reports table

- **WHEN** the Alembic migration runs
- **THEN** the `reports` table SHALL exist with all specified columns
- **THEN** the `project_id` foreign key SHALL reference `projects.id`

---

### Requirement: Report dbt Export

The system SHALL generate mart model SQL files for Reports during dbt project export.

- Fact Reports SHALL export as `models/marts/{domain_snake}/fct_{snake_case_name}.sql`.
- Dimension Reports SHALL export as `models/marts/{domain_snake}/dim_{snake_case_name}.sql`.
- The `domain` field SHALL be converted to snake_case for the subdirectory name.
- The exported SQL SHALL include a `{{ config(materialized='{materialization}') }}` block.
- Source references SHALL use `{{ ref('int_...') }}` for Views and `{{ ref('stg_...') }}` for Datasets.

#### Scenario: Export a fact Report in the Finance domain

- **WHEN** a project has a Report named "Invoices" with `report_type: "fact"`, `domain: "Finance"`, and `materialization: "view"`
- **THEN** the export SHALL produce `models/marts/finance/fct_invoices.sql`
- **THEN** the file SHALL begin with `{{ config(materialized='view') }}`

#### Scenario: Export a dimension Report in the default domain

- **WHEN** a Report has `domain: "Organization"`
- **THEN** the export SHALL place it in `models/marts/organization/dim_{name}.sql`

#### Scenario: Export Reports with mixed domains

- **WHEN** a project has Reports in domains "Finance" and "Marketing"
- **THEN** the export SHALL create subdirectories `models/marts/finance/` and `models/marts/marketing/`
