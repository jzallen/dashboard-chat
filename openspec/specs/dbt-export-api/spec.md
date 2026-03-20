# dbt-export-api Specification

## Purpose

Defines the dbt project export API endpoint. Authenticated users can export a project as a dbt zip archive containing staging models for datasets, intermediate models for views, and mart models for reports. The export pipeline is format-agnostic and plugin-aware.

## Requirements

### Requirement: Export Endpoint

The system SHALL expose a GET endpoint at `/api/projects/{project_id}/export/dbt` that returns a zip archive containing a dbt project generated from the specified project's datasets **and views** and transforms.

- The endpoint SHALL accept a `project_id` path parameter.
- The endpoint SHALL return a response with `Content-Type: application/zip`.
- The endpoint SHALL include a `Content-Disposition` header with value `attachment; filename="{project_name}_dbt.zip"` where `{project_name}` is the project name in snake_case.
- The endpoint SHALL use `StreamingResponse` from FastAPI to return the binary content.
- The endpoint SHALL depend on `use_db_context` to establish the database session context.

#### Scenario: Successful export returns zip with correct headers

- **WHEN** an authenticated user requests `GET /api/projects/{project_id}/export/dbt` for a project they own named "Sales Pipeline"
- **THEN** the response status code SHALL be 200
- **THEN** the `Content-Type` header SHALL be `application/zip`
- **THEN** the `Content-Disposition` header SHALL be `attachment; filename="sales_pipeline_dbt.zip"`
- **THEN** the response body SHALL be a valid zip archive

#### Scenario: Zip file includes intermediate models when views exist

- **WHEN** the project has views
- **THEN** the zip SHALL contain `models/intermediate/` with one `int_{name}.sql` file per view
- **AND** the zip SHALL also contain `models/staging/` with one `stg_{name}.sql` file per dataset

#### Scenario: Zip file is staging-only when no views exist

- **WHEN** the project has datasets but no views
- **THEN** the zip SHALL contain only `models/staging/` with no `models/intermediate/` directory

#### Scenario: Zip file is downloadable and extractable

- **WHEN** the client receives the zip response
- **THEN** the response body SHALL be a valid zip file that can be extracted by standard zip utilities
- **THEN** the extracted contents SHALL match the dbt project file structure defined in the `dbt-project-generation` capability

#### Scenario: Export with broken source references returns error

- **WHEN** a View references a Dataset that has been deleted
- **THEN** the export SHALL return a 400 error with detail identifying the broken reference and affected model name
- **THEN** the response SHALL be JSON in RFC 9457 format with `type: "EXPORT_VALIDATION_ERROR"`

---

### Requirement: Authentication and Authorization

The system SHALL enforce authentication and organization-level authorization on the export endpoint, consistent with the existing project access patterns.

- The endpoint SHALL require a valid Bearer token in the Authorization header (enforced by existing auth middleware).
- The use case SHALL verify that the authenticated user's `org_id` matches the project's `org_id`.
- If the user's `org_id` does not match the project's `org_id`, the system SHALL return a 403 Forbidden response.
- If the project does not exist, the system SHALL return a 404 Not Found response.

#### Scenario: Authorized user exports their project

- **WHEN** a user with `org_id = "org-1"` requests export of a project with `org_id = "org-1"`
- **THEN** the system SHALL return the zip archive with status 200

#### Scenario: Unauthorized access to another org's project

- **WHEN** a user with `org_id = "org-1"` requests export of a project with `org_id = "org-2"`
- **THEN** the system SHALL return a 403 Forbidden response
- **THEN** the response body SHALL be a JSON error in RFC 9457 format with `type: "ACCESS_DENIED"`

#### Scenario: Export of non-existent project

- **WHEN** a user requests export of a project ID that does not exist
- **THEN** the system SHALL return a 404 Not Found response
- **THEN** the response body SHALL be a JSON error in RFC 9457 format with `type: "PROJECT_NOT_FOUND"`

#### Scenario: Unauthenticated request is rejected

- **WHEN** a request to the export endpoint has no Authorization header or an invalid token
- **THEN** the auth middleware SHALL reject the request before it reaches the use case
- **THEN** the response SHALL be 401 Unauthorized

---

### Requirement: Error Response Format

The system SHALL return JSON error responses for failure cases, using the same RFC 9457 format as other endpoints in the codebase.

- Error responses SHALL use `JSONResponse` (not `StreamingResponse`).
- Error responses SHALL include `type`, `title`, `status`, and `detail` fields.
- The error format SHALL match the pattern produced by `_error_response()` in the existing controller.

#### Scenario: 403 error response format

- **WHEN** an authorization error occurs during export
- **THEN** the response SHALL be JSON with `Content-Type: application/json`
- **THEN** the body SHALL contain `{"type": "ACCESS_DENIED", "title": "Access Denied", "status": 403, "detail": "..."}`

#### Scenario: 404 error response format

- **WHEN** a project-not-found error occurs during export
- **THEN** the response SHALL be JSON with `Content-Type: application/json`
- **THEN** the body SHALL contain `{"type": "PROJECT_NOT_FOUND", "title": "Project Not Found", "status": 404, "detail": "..."}`

---

### Requirement: Route Handler Pattern

The export route handler SHALL call the use case directly and handle the `Success`/`Failure` result inline, bypassing the `HTTPController` static method pattern. This is necessary because binary responses cannot be expressed as `tuple[dict, int]`.

- The route handler SHALL call the `export_dbt_project` use case.
- On `Success`, the handler SHALL return a `StreamingResponse` with the zip bytes.
- On `Failure`, the handler SHALL return a `JSONResponse` with the appropriate error status code and RFC 9457 body.
- The route SHALL be defined in `backend/app/routers/projects.py` alongside existing project routes.

#### Scenario: Success path returns StreamingResponse

- **WHEN** the use case returns `Success((zip_bytes, project_name))`
- **THEN** the handler SHALL return `StreamingResponse` with `media_type="application/zip"`
- **THEN** the `Content-Disposition` header SHALL use the `project_name` for the filename

#### Scenario: Failure path returns JSONResponse

- **WHEN** the use case returns `Failure(error)`
- **THEN** the handler SHALL return `JSONResponse` with the error's status code
- **THEN** the response body SHALL follow the RFC 9457 error format

---

### Requirement: Frontend Download Function

The frontend SHALL provide a function that initiates the dbt project download by fetching the export endpoint with authentication headers and triggering a browser file download.

- The function SHALL send a GET request to `/api/projects/{project_id}/export/dbt` with the current user's Bearer token.
- On a successful response, the function SHALL convert the response to a Blob.
- The function SHALL extract the filename from the `Content-Disposition` header, falling back to `"export.zip"` if the header is missing.
- The function SHALL trigger a browser download by creating a temporary anchor element with the blob URL, clicking it programmatically, and revoking the object URL.
- On a non-OK response, the function SHALL throw an error with a meaningful message.

#### Scenario: Successful download triggers browser save dialog

- **WHEN** the user triggers a dbt export from the UI
- **THEN** the function SHALL fetch the endpoint with auth headers
- **THEN** the browser SHALL present a file download for the zip archive
- **THEN** the downloaded filename SHALL match the `Content-Disposition` header value

#### Scenario: Download with missing Content-Disposition header

- **WHEN** the response lacks a `Content-Disposition` header (unexpected but possible)
- **THEN** the function SHALL use `"export.zip"` as the fallback filename

#### Scenario: Server error during download

- **WHEN** the server returns a non-200 response (e.g., 403, 404, 500)
- **THEN** the function SHALL throw an error
- **THEN** the function SHALL NOT trigger a browser download

---

### Requirement: Frontend UI Trigger

The frontend SHALL provide a UI element (button or menu item) in the project view that initiates the dbt project export.

- The UI element SHALL be accessible from the project view.
- The UI element SHALL call the frontend download function when activated.
- The UI element SHALL provide visual feedback during the download (e.g., loading state).
- The UI element SHALL handle and display errors if the download fails.

#### Scenario: User clicks export button

- **WHEN** the user clicks the "Export as dbt" button in the project view
- **THEN** the frontend SHALL call the download function with the current project ID
- **THEN** the button SHALL show a loading state while the download is in progress

#### Scenario: Export button shows error on failure

- **WHEN** the download function throws an error (e.g., 403 or network error)
- **THEN** the UI SHALL display an error message to the user
- **THEN** the button SHALL return to its default state

---

### Requirement: Plugin-Created Datasets Export Correctly

Datasets created by any registered file format plugin SHALL export correctly via the dbt export API. The export pipeline SHALL be format-agnostic — it operates on `schema_config`, `transforms`, and Parquet storage regardless of source format.

- Datasets created by Excel, HL7v2, or FHIR plugins SHALL appear in `sources.yml` with correct storage paths.
- Staging model SQL files SHALL be generated for plugin-created datasets using the same CTE pipeline logic.
- Column definitions in `schema.yml` SHALL reflect the `schema_config` stored at dataset creation time (which may include plugin schema hints).
- The zip archive SHALL be valid and buildable by dbt regardless of which plugins created the datasets.

#### Scenario: HL7v2 dataset exports to dbt
- **WHEN** a project contains a dataset created by the HL7v2 plugin with columns `msh_message_type`, `pid_patient_id`, `pid_patient_name`
- **THEN** `sources.yml` SHALL list the dataset with its storage path
- **THEN** `schema.yml` SHALL list the model with all three columns and their types
- **THEN** `stg_{dataset_name}.sql` SHALL be generated with the standard CTE pipeline

#### Scenario: Mixed-format project exports correctly
- **WHEN** a project contains one CSV dataset, one Excel dataset, and one FHIR dataset
- **THEN** all three SHALL appear in `sources.yml`
- **THEN** all three SHALL have staging model SQL files
- **THEN** the dbt project SHALL be structurally valid

#### Scenario: Plugin schema hints are reflected in export
- **WHEN** a FHIR dataset was created with `schema_hints={"birth_date": "datetime"}`
- **THEN** the `schema_config` SHALL record `birth_date` as `"datetime"`
- **THEN** `schema.yml` SHALL map `birth_date` to the appropriate dbt type

