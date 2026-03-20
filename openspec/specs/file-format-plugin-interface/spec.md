# File Format Plugin Interface

## Purpose

Defines the protocol, data types, and return contracts for file format plugins. Plugins process uploaded files into tabular DataFrames with optional metadata for schema inference, chat guidance, and multi-dataset output.

## Requirements

### Requirement: FileFormatPlugin Protocol

The system SHALL define a `FileFormatPlugin` Protocol in `backend/app/plugins/protocol.py` that all file format processors MUST implement. The protocol SHALL define the minimal contract for file validation, processing, and optional extension points.

Each plugin SHALL declare:
- `name: str` — unique identifier for the plugin
- `extensions: list[str]` — file extensions this plugin handles (e.g., `[".csv"]`)
- `validate(file_content: bytes, filename: str) -> None` — raises `PluginValidationError` if invalid
- `process(file_content: bytes, filename: str, choices: dict[str, str] | None) -> ProcessingResult` — converts raw bytes to tabular data

#### Scenario: Plugin implements required protocol methods
- **WHEN** a class implements the `FileFormatPlugin` protocol with `name`, `extensions`, `validate`, and `process`
- **THEN** the class SHALL be accepted by the plugin registry without error
- **THEN** `isinstance` checks against the protocol SHALL pass

#### Scenario: Plugin missing required method is rejected
- **WHEN** a class is missing the `process` method
- **THEN** the registry SHALL raise a `TypeError` at registration time
- **THEN** other registered plugins SHALL continue to function

---

### Requirement: Plugin Registry

The system SHALL provide a `PluginRegistry` class that manages the mapping from file extensions to plugin instances. The registry SHALL be created once at application startup and stored in `app.state.plugin_registry`.

- The registry SHALL be initialized with a list of `FileFormatPlugin` instances.
- The registry SHALL build an extension-to-plugin lookup map at initialization.
- `get_for_extension(ext: str) -> FileFormatPlugin | None` SHALL return the plugin for a given extension.
- `supported_extensions() -> list[str]` SHALL return all registered extensions.
- `get_by_name(name: str) -> FileFormatPlugin | None` SHALL return a plugin by its unique name.
- `all_plugins() -> list[FileFormatPlugin]` SHALL return all registered plugins.

#### Scenario: Registry resolves plugin by extension
- **WHEN** a `CsvPlugin` is registered with `extensions=[".csv"]`
- **THEN** `registry.get_for_extension(".csv")` SHALL return the `CsvPlugin` instance
- **THEN** `registry.get_for_extension(".xlsx")` SHALL return `None`

#### Scenario: Registry lists all supported extensions
- **WHEN** plugins for CSV (`.csv`), Excel (`.xlsx`, `.xls`), and HL7v2 (`.hl7`) are registered
- **THEN** `registry.supported_extensions()` SHALL return `[".csv", ".xlsx", ".xls", ".hl7"]`

#### Scenario: Registry rejects duplicate extensions at startup
- **WHEN** two plugins both claim the `.json` extension
- **THEN** the registry SHALL raise a `ValueError` during initialization
- **THEN** the error message SHALL identify both conflicting plugin names and the contested extension

---

### Requirement: Registry Factory Function

The system SHALL provide a `create_plugin_registry()` factory function that constructs the registry with all built-in plugins. This function SHALL be called during FastAPI lifespan startup.

- The factory SHALL instantiate and register: `CsvPlugin`, `ExcelPlugin`, `Hl7v2Plugin`, `FhirPlugin`.
- The registry instance SHALL be stored in `app.state.plugin_registry`.
- Use cases SHALL receive the registry as a parameter from the router/controller layer.

#### Scenario: Registry is available after startup
- **WHEN** the FastAPI application completes startup
- **THEN** `app.state.plugin_registry` SHALL be a `PluginRegistry` instance
- **THEN** the registry SHALL contain at least the `CsvPlugin`

#### Scenario: Registry is injected into upload use case
- **WHEN** a file upload request is received
- **THEN** the router SHALL pass the registry to the use case
- **THEN** the use case SHALL use the registry to resolve the appropriate plugin by file extension

---

### Requirement: Plugin Isolation

A failing plugin SHALL NOT affect other plugins or core platform stability. Plugin errors SHALL be caught and surfaced as user-facing messages.

- Plugin `validate()` and `process()` calls SHALL be wrapped in try/except by the platform.
- `PluginValidationError` exceptions SHALL be converted to user-friendly error responses.
- Unexpected exceptions from plugins SHALL be logged with the plugin name and re-raised as a generic processing error.
- Plugin processing SHALL run in `asyncio.to_thread()` to avoid blocking the event loop.
- Plugin processing SHALL be subject to a configurable timeout (default 120 seconds).

#### Scenario: Plugin validation error is surfaced
- **WHEN** a plugin's `validate()` raises `PluginValidationError("File contains no data rows")`
- **THEN** the upload endpoint SHALL return a 400 response with the validation message
- **THEN** no dataset SHALL be created

#### Scenario: Plugin processing timeout
- **WHEN** a plugin's `process()` exceeds the configured timeout
- **THEN** the platform SHALL cancel the processing thread
- **THEN** the upload endpoint SHALL return a 408 or 500 response with a timeout message
- **THEN** no partial dataset SHALL be created

#### Scenario: Plugin crash does not affect other formats
- **WHEN** the `Hl7v2Plugin.process()` raises an unhandled exception
- **THEN** the CSV and Excel plugins SHALL continue to function normally for subsequent requests

---

### Requirement: Formats Discovery Endpoint

The system SHALL expose a `GET /api/formats` endpoint that returns metadata about all registered file format plugins.

- The response SHALL include each plugin's `name`, `extensions`, and a human-readable `label`.
- The endpoint SHALL NOT require authentication (it returns no sensitive data).
- The response SHALL be JSON with the structure `{"formats": [{"name": str, "extensions": [str], "label": str}]}`.

#### Scenario: Formats endpoint returns all registered plugins
- **WHEN** CSV, Excel, HL7v2, and FHIR plugins are registered
- **THEN** `GET /api/formats` SHALL return a JSON array with 4 entries
- **THEN** each entry SHALL include `name`, `extensions`, and `label` fields

#### Scenario: Frontend uses formats to build upload dialog
- **WHEN** the upload widget mounts
- **THEN** it SHALL fetch `GET /api/formats`
- **THEN** the file input `accept` attribute SHALL include all extensions from the response

---

### Requirement: Generic Upload Pipeline

The system SHALL replace the hardcoded CSV validation in `upload_file.py` with a plugin-based resolution. The file extension SHALL determine which plugin processes the upload.

- The upload endpoint SHALL extract the file extension from the filename.
- The upload endpoint SHALL query the registry for a matching plugin.
- If no plugin matches the extension, the endpoint SHALL return a 400 response listing supported formats.
- The matched plugin's `validate()` SHALL be called before any storage.
- The matched plugin's `process()` SHALL be called to produce the DataFrame.
- The existing `analyze_dataframe()`, Parquet writing, and metadata creation pipeline SHALL continue unchanged after the plugin produces the DataFrame.

#### Scenario: CSV upload works identically after refactor
- **WHEN** a user uploads a `.csv` file
- **THEN** the `CsvPlugin` SHALL validate and process it
- **THEN** the resulting dataset SHALL be identical to pre-refactor behavior

#### Scenario: Unsupported extension is rejected
- **WHEN** a user uploads a `.xml` file and no XML plugin is registered
- **THEN** the endpoint SHALL return 400 with message indicating supported formats
- **THEN** no outbox event SHALL be created

#### Scenario: Plugin schema hints override inference
- **WHEN** a plugin returns `ProcessingResult` with `schema_hints={"patient_id": "text"}`
- **THEN** the `schema_config` for column `patient_id` SHALL use type `"text"` regardless of inference
- **THEN** other columns SHALL use inferred types

---

### Requirement: ProcessingResult Data Class

The system SHALL define a `ProcessingResult` dataclass that plugins return from `process()`. The result SHALL contain the tabular DataFrame and optional metadata.

- `df: pd.DataFrame` — the processed tabular data (REQUIRED)
- `schema_hints: dict[str, str] | None` — column type overrides (optional, maps column name to schema type)
- `default_transforms: list[dict] | None` — transforms to auto-apply (optional)
- `dbt_macros: dict[str, str] | None` — per-file dbt macros (optional, maps macro name to SQL body)
- `chat_guidance: str | None` — format-specific LLM context (optional)
- `name: str | None` — dataset name label for multi-dataset results (optional, defaults to None for single-dataset plugins)

#### Scenario: Plugin returns DataFrame only
- **WHEN** a plugin returns `ProcessingResult(df=dataframe)` with no optional fields
- **THEN** the platform SHALL use default schema inference on the DataFrame
- **THEN** no default transforms SHALL be applied
- **THEN** no additional chat guidance SHALL be injected

#### Scenario: Plugin returns schema hints
- **WHEN** a plugin returns `ProcessingResult(df=dataframe, schema_hints={"age": "number", "name": "text"})`
- **THEN** the platform SHALL use the plugin's type mappings instead of inference for the specified columns
- **THEN** columns not in `schema_hints` SHALL still use default inference

#### Scenario: Plugin returns named result for multi-dataset
- **WHEN** a plugin returns `ProcessingResult(df=dataframe, name="Patient")`
- **THEN** the platform SHALL use `"Patient"` as the dataset name when creating the dataset record

---

### Requirement: MultiProcessingResult Data Class

The system SHALL define a `MultiProcessingResult` dataclass for plugins that produce multiple datasets from a single upload. It SHALL contain a list of `ProcessingResult` items, each representing one output dataset.

- `results: list[ProcessingResult]` — one or more named processing results (REQUIRED, each item MUST have `name` set)
- `chat_guidance: str | None` — overall guidance describing the relationship between the datasets (optional)

#### Scenario: Multi-dataset plugin returns multiple results
- **WHEN** a plugin returns `MultiProcessingResult(results=[ProcessingResult(df=df1, name="Patient"), ProcessingResult(df=df2, name="Observation")])`
- **THEN** the platform SHALL create two datasets named "Patient" and "Observation"
- **THEN** each dataset SHALL use its own `schema_hints` and `chat_guidance`

#### Scenario: MultiProcessingResult with unnamed items is rejected
- **WHEN** a plugin constructs `MultiProcessingResult` with a `ProcessingResult` that has `name=None`
- **THEN** `MultiProcessingResult.__post_init__` SHALL raise `ValueError` indicating all items must be named

#### Scenario: Empty results list is rejected
- **WHEN** a plugin constructs `MultiProcessingResult(results=[])`
- **THEN** `MultiProcessingResult.__post_init__` SHALL raise `ValueError` indicating at least one result is required

---

### Requirement: FileFormatPlugin process return type

The `FileFormatPlugin.process()` method SHALL accept a return type of `ProcessingResult | MultiProcessingResult`. Existing plugins returning `ProcessingResult` SHALL continue to work without modification.

#### Scenario: CSV plugin returns single ProcessingResult
- **WHEN** the CSV plugin processes a file
- **THEN** it SHALL return `ProcessingResult` (unchanged from current behavior)
- **THEN** the platform SHALL handle it via the single-dataset path

#### Scenario: FHIR plugin returns MultiProcessingResult
- **WHEN** the FHIR plugin processes a Bundle with multiple resource types
- **THEN** it SHALL return `MultiProcessingResult`
- **THEN** the platform SHALL handle it via the multi-dataset path
