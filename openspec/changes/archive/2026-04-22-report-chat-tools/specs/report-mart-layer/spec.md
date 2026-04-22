## MODIFIED Requirements

### Requirement: Report Entity CRUD

The system SHALL support creating, reading, updating, and deleting Report entities within a project. A Report represents a mart-layer dbt model — a consumption-ready business entity (fact or dimension).

- The system SHALL expose REST endpoints for Report CRUD under `/api/projects/{project_id}/reports`.
- Each Report SHALL have: `id` (UUIDv7), `project_id`, `org_id`, `name`, `description` (optional), `sql_definition`, `source_refs`, `report_type`, `domain`, `columns_metadata`, `materialization`, `created_at`, `updated_at`.
- Reports SHALL be scoped by `org_id` via their parent project.
- The `report_type` field SHALL accept values: `"fact"` or `"dimension"`.
- The `domain` field SHALL default to `"Organization"`.
- The `materialization` field SHALL default to `"view"` and accept values: `"ephemeral"`, `"view"`, `"table"`, `"incremental"`.
- Report CRUD SHALL be operable via chat tools in addition to direct API calls. The chat agent SHALL invoke the same REST endpoints.

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

#### Scenario: Create Report via chat tool

- **WHEN** the chat agent emits a `createReport` tool call with `name: "Orders"`, `report_type: "fact"`
- **THEN** the frontend SHALL POST to `/api/projects/{project_id}/reports` with the provided parameters
- **THEN** the new Report SHALL appear in the project's report list
