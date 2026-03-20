## MODIFIED Requirements

### Requirement: Export Endpoint

The system SHALL expose a GET endpoint at `/api/projects/{project_id}/export/dbt` that returns a zip archive containing a dbt project generated from the specified project's datasets, views, and reports.

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

#### Scenario: Zip file is downloadable and extractable

- **WHEN** the client receives the zip response
- **THEN** the response body SHALL be a valid zip file that can be extracted by standard zip utilities
- **THEN** the extracted contents SHALL match the dbt project file structure defined in the `dbt-project-generation` capability, including intermediate and mart model files

#### Scenario: Export with broken source references returns error

- **WHEN** a View references a Dataset that has been deleted
- **THEN** the export SHALL return a 400 error with detail identifying the broken reference and affected model name
- **THEN** the response SHALL be JSON in RFC 9457 format with `type: "EXPORT_VALIDATION_ERROR"`
