## ADDED Requirements

### Requirement: PluginChoice Data Model

The system SHALL define a `PluginChoice` dataclass that plugins use to declare user input needed during processing.

- `key: str` — identifier for the choice (e.g., `"sheet_name"`, `"resource_type"`)
- `label: str` — human-readable prompt displayed in chat (e.g., `"Select a sheet to import"`)
- `options: list[str]` — available options for the user to choose from

#### Scenario: Plugin declares a single choice
- **WHEN** the Excel plugin detects 3 sheets named "Sales", "Returns", "Inventory"
- **THEN** `detect_choices()` SHALL return `[PluginChoice(key="sheet_name", label="Select a sheet to import", options=["Sales", "Returns", "Inventory"])]`

#### Scenario: Plugin declares no choices
- **WHEN** the CSV plugin inspects any valid CSV file
- **THEN** `detect_choices()` SHALL return `None`
- **THEN** processing SHALL proceed immediately without user interaction

---

### Requirement: Two-Phase Processing Protocol

The `FileFormatPlugin` protocol SHALL include an optional `detect_choices()` method that enables interactive processing. The platform SHALL mediate user interaction between the detect and process phases.

- `detect_choices(file_content: bytes, filename: str) -> list[PluginChoice] | None` — inspects the file and returns choices needed, or `None` if none needed.
- When `detect_choices()` returns `None`, `process()` SHALL be called immediately with `choices=None`.
- When `detect_choices()` returns choices, the platform SHALL pause processing and surface the choices to the user.
- After the user selects, `process()` SHALL be called with `choices={"key": "selected_value"}`.
- Plugins that do not need interactive processing MAY implement `detect_choices()` to always return `None`.

#### Scenario: Non-interactive plugin skips choice phase
- **WHEN** a CSV file is uploaded and `CsvPlugin.detect_choices()` returns `None`
- **THEN** `CsvPlugin.process()` SHALL be called immediately with `choices=None`
- **THEN** the upload SHALL complete in a single request

#### Scenario: Interactive plugin pauses for user input
- **WHEN** an Excel file is uploaded and `ExcelPlugin.detect_choices()` returns choices
- **THEN** the upload response SHALL have `status: "awaiting_input"`
- **THEN** the response SHALL include the choice definitions
- **THEN** no dataset SHALL be created until the user responds

---

### Requirement: Upload Awaiting Input State

The system SHALL support an `"awaiting_input"` upload status for files that require user choices before processing can complete.

- When `detect_choices()` returns choices, the outbox event SHALL be created with the raw file stored in S3, but no dataset SHALL be created yet.
- The upload response SHALL include `status: "awaiting_input"` and a `choices` array.
- The outbox record SHALL store the plugin name and detected choices in its payload for retrieval during the process phase.

#### Scenario: Upload returns awaiting_input with choices
- **WHEN** an Excel file with sheets ["Q1", "Q2", "Q3"] is uploaded
- **THEN** the response SHALL include `status: "awaiting_input"`
- **THEN** the response SHALL include `choices: [{"key": "sheet_name", "label": "Select a sheet to import", "options": ["Q1", "Q2", "Q3"]}]`
- **THEN** the raw file SHALL be stored in S3 at `uploads/{project_id}/{filename}`

---

### Requirement: Process Upload With Choices Endpoint

The system SHALL expose a `POST /api/uploads/{upload_id}/process` endpoint that completes processing for uploads in `"awaiting_input"` status.

- The request body SHALL include `choices: dict[str, str]` with the user's selections.
- The endpoint SHALL retrieve the outbox event, re-read the raw file from S3, and call `plugin.process()` with the choices.
- The endpoint SHALL then continue the standard pipeline (analyze, write Parquet, create dataset).
- If the upload is not in `"awaiting_input"` status, the endpoint SHALL return 409 Conflict.
- If the choices are invalid (missing required keys), the endpoint SHALL return 400.

#### Scenario: Process upload with valid sheet selection
- **WHEN** `POST /api/uploads/{id}/process` is called with `{"choices": {"sheet_name": "Q2"}}`
- **THEN** `ExcelPlugin.process()` SHALL be called with `choices={"sheet_name": "Q2"}`
- **THEN** a dataset SHALL be created from the Q2 sheet data
- **THEN** the outbox event SHALL be marked as processed

#### Scenario: Process upload with invalid choices
- **WHEN** `POST /api/uploads/{id}/process` is called with `{"choices": {}}` (missing required key)
- **THEN** the endpoint SHALL return 400 with a message indicating the missing choice key
- **THEN** no dataset SHALL be created

#### Scenario: Process already-processed upload
- **WHEN** `POST /api/uploads/{id}/process` is called for an upload already marked as processed
- **THEN** the endpoint SHALL return 409 Conflict

---

### Requirement: Chat-Mediated Choice Rendering

The frontend SHALL render plugin choices in the chat interface using existing chat message patterns. The user's selection SHALL be sent to the process endpoint.

- When the upload response contains `status: "awaiting_input"`, the chat SHALL display the choice options.
- Each `PluginChoice` SHALL be rendered with its `label` as a prompt and `options` as selectable buttons or a list.
- When the user selects an option, the frontend SHALL call `POST /api/uploads/{id}/process` with the selection.
- After successful processing, the standard dataset-created flow SHALL resume (sidebar update, grid display).

#### Scenario: Chat renders sheet selection for Excel file
- **WHEN** an Excel upload returns `awaiting_input` with sheet choices
- **THEN** the chat SHALL display "Select a sheet to import" with buttons for each sheet name
- **THEN** clicking a sheet button SHALL trigger the process endpoint

#### Scenario: Chat renders resource type selection for FHIR bundle
- **WHEN** a FHIR upload returns `awaiting_input` with resource type choices
- **THEN** the chat SHALL display "Select a resource type to import" with options like "Patient", "Observation"
- **THEN** selecting a type SHALL trigger processing with that resource type
