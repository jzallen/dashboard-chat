## 1. Plugin Infrastructure

- [x] 1.1 Create `backend/app/plugins/` package with `__init__.py`
- [x] 1.2 Define `FileFormatPlugin` Protocol, `ProcessingResult`, `PluginChoice`, and `PluginValidationError` in `backend/app/plugins/protocol.py`
- [x] 1.3 Implement `PluginRegistry` class with extension lookup, name lookup, duplicate detection, and `all_plugins()` / `supported_extensions()` methods
- [x] 1.4 Implement `create_plugin_registry()` factory function in `backend/app/plugins/__init__.py`
- [x] 1.5 Wire registry creation into FastAPI lifespan in `backend/app/main.py` → `app.state.plugin_registry`
- [x] 1.6 Add unit tests for `PluginRegistry` (register, lookup, duplicate rejection, unknown extension)

## 2. CSV Plugin (Reference Implementation)

- [x] 2.1 Create `backend/app/plugins/csv_plugin.py` implementing `FileFormatPlugin` — extract logic from `backend/app/utils/csv_parser.py`
- [x] 2.2 Implement `validate()` (reject empty files), `detect_choices()` (always `None`), `process()` (pandas `read_csv`, strip whitespace)
- [x] 2.3 Add unit tests for `CsvPlugin` (valid file, empty file, headers-only, whitespace stripping)
- [x] 2.4 Verify backward compatibility: existing CSV upload test suite passes with the plugin path

## 3. Generic Upload Pipeline

- [x] 3.1 Modify `backend/app/routers/uploads.py` to accept the plugin registry from `app.state` and pass to use case
- [x] 3.2 Refactor `backend/app/use_cases/upload/upload_file.py` — replace hardcoded `.csv` validation with registry lookup → `plugin.validate()` → `plugin.detect_choices()`
- [x] 3.3 Refactor `backend/app/use_cases/dataset/_pipeline/ingestion.py` — replace `parse_and_clean_csv()` with `plugin.process()`, merge `schema_hints` into inference
- [x] 3.4 Update `analyze_dataframe()` to accept optional `schema_hints` and override inferred types
- [x] 3.5 Store `plugin_name` in `UploadFileReceived` event payload for tracing
- [x] 3.6 Handle unsupported extensions: return 400 with list of supported formats
- [x] 3.7 Wrap `plugin.validate()` and `plugin.process()` calls with try/except and `asyncio.wait_for()` timeout
- [x] 3.8 Update existing upload tests to work with the refactored plugin-based pipeline

## 4. Interactive Processing (Two-Phase Upload)

- [x] 4.1 Add `"awaiting_input"` status to upload response model
- [x] 4.2 Store detected choices and plugin name in outbox event payload when `detect_choices()` returns choices
- [x] 4.3 Create `POST /api/uploads/{upload_id}/process` endpoint in `backend/app/routers/uploads.py`
- [x] 4.4 Create `process_upload_with_choices` use case — retrieve outbox event, re-read raw file, call `plugin.process(choices)`, continue pipeline
- [x] 4.5 Add validation: reject if upload not `awaiting_input`, reject if required choice keys missing
- [x] 4.6 Add unit tests for the two-phase flow (detect choices → process with choices)

## 5. Formats Discovery Endpoint

- [x] 5.1 Create `GET /api/formats` endpoint in `backend/app/routers/uploads.py` (or new `formats.py` router)
- [x] 5.2 Return `{"formats": [{"name", "extensions", "label"}]}` from registry
- [x] 5.3 Add test for formats endpoint response shape

## 6. Frontend Upload Widget Changes

- [x] 6.1 Fetch `GET /api/formats` on upload widget mount and cache the result
- [x] 6.2 Set file input `accept` attribute dynamically from fetched formats
- [x] 6.3 Render `PluginChoice` options in chat when upload returns `awaiting_input`
- [x] 6.4 Send `POST /api/uploads/{id}/process` with user's choice selection
- [x] 6.5 Resume normal dataset-created flow after successful processing

## 7. Excel Plugin

- [x] 7.1 Add `openpyxl` dependency to `backend/pyproject.toml`
- [x] 7.2 Create `backend/app/plugins/excel_plugin.py` implementing `FileFormatPlugin`
- [x] 7.3 Implement `validate()` — reject non-Excel files via openpyxl load attempt
- [x] 7.4 Implement `detect_choices()` — return sheet names if multiple sheets, `None` if single sheet
- [x] 7.5 Implement `process()` — read selected sheet via `pd.read_excel(engine="openpyxl")`
- [x] 7.6 Add unit tests (single sheet, multi-sheet choice, corrupt file, invalid sheet name)

## 8. HL7v2 Plugin

- [x] 8.1 Evaluate and add HL7v2 parsing library (`hl7apy` or `python-hl7`) to `backend/pyproject.toml`
- [x] 8.2 Create `backend/app/plugins/hl7v2_plugin.py` implementing `FileFormatPlugin`
- [x] 8.3 Implement `validate()` — check for MSH segment presence
- [x] 8.4 Implement `process()` — parse messages, flatten MSH/PID/PV1 segments to columns with `{segment}_{field}` naming
- [x] 8.5 Add `chat_guidance` to `ProcessingResult` describing HL7v2 column conventions
- [x] 8.6 Optionally define class-level `dbt_macros` for HL7v2 helpers
- [x] 8.7 Add unit tests (single message, multiple messages, missing segments, invalid file)

## 9. FHIR Plugin

- [x] 9.1 Evaluate FHIR parsing approach (manual JSON vs `fhir.resources` library) and add dependency if needed
- [x] 9.2 Create `backend/app/plugins/fhir_plugin.py` implementing `FileFormatPlugin`
- [x] 9.3 Implement `validate()` — check for valid JSON/NDJSON with `resourceType` fields
- [x] 9.4 Implement `detect_choices()` — scan for distinct resource types, prompt if multiple
- [x] 9.5 Implement `process()` — extract resources of selected type, flatten to columns (top-level + one nesting level, snake_case names)
- [x] 9.6 Return `schema_hints` for known FHIR date/boolean/numeric fields
- [x] 9.7 Add `chat_guidance` describing FHIR resource structure
- [x] 9.8 Add unit tests (single type bundle, multi-type bundle, nested fields, NDJSON format, invalid JSON)

## 10. dbt Export Integration

- [x] 10.1 Extend `generate_macros_sql()` in `backend/app/use_cases/project/_dbt/macros_sql.py` to accept the plugin registry
- [x] 10.2 Collect `dbt_macros` from all registered plugins and write to `macros/plugin_{name}.sql` files
- [x] 10.3 Pass registry to `generate_dbt_project_zip()` from the export use case
- [x] 10.4 Add tests: export with plugin macros, export without plugin macros (backward compat)

## 11. Dataset Format Context

- [x] 11.1 Create Alembic migration adding nullable `format_context: Text` column to `datasets` table
- [x] 11.2 Update `DatasetRecord` ORM model with `format_context` column
- [x] 11.3 Update `Dataset` domain model with `format_context` field
- [x] 11.4 Store `ProcessingResult.chat_guidance` into `format_context` during dataset creation
- [x] 11.5 Inject `format_context` into LLM system prompt in the chat prompt builder (worker/shared)

## 12. Integration Testing

- [x] 12.1 End-to-end test: upload `.csv` file → dataset created (regression)
- [x] 12.2 End-to-end test: upload `.xlsx` single-sheet file → dataset created
- [x] 12.3 End-to-end test: upload `.xlsx` multi-sheet → choices → select → dataset created
- [x] 12.4 End-to-end test: upload `.hl7` file → HL7v2 dataset with flattened columns
- [x] 12.5 End-to-end test: upload `.ndjson` FHIR bundle → resource type selection → dataset created
- [x] 12.6 End-to-end test: export dbt project with mixed-format datasets → valid zip with plugin macros
