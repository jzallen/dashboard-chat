## Why

The platform only supports CSV uploads. Users with healthcare data (HL7v2, FHIR) or common business formats (Excel) must manually convert to CSV before uploading. This creates adoption friction in healthcare and enterprise environments. A plugin system lets developers extend supported formats without modifying core upload/ingestion code.

## What Changes

- **New `FileFormatPlugin` protocol** — Backend protocol (following the `AuthProvider` pattern) that defines the contract for file format processors: validate, parse-to-DataFrame, optional schema hints, optional default transforms, optional dbt macros, optional chat guidance.
- **Plugin registry** — Startup-loaded registry that maps file extensions to plugin instances. Resolves conflicts explicitly via priority config.
- **Refactor CSV into a plugin** — Extract current `parse_and_clean_csv()` + schema inference logic from `upload_file` / `create_dataset_from_upload` into a `CsvPlugin` reference implementation.
- **Interactive processing model** — Plugins can declare "choices needed" (e.g., Excel sheet selection, FHIR resource type selection) that the platform mediates through the chat UX.
- **Generic ingestion pipeline** — The current hardcoded CSV path in `upload_file.py` and `_pipeline/ingestion.py` becomes format-agnostic: extension lookup → plugin.validate → plugin.process → existing analyze/write/store pipeline.
- **Upload dialog extension** — Frontend upload widget dynamically accepts all registered extensions (from `GET /api/formats` or similar).
- **Excel, HL7v2, FHIR plugins** — Three new plugins shipped alongside the CSV reference plugin.
- **dbt macro contribution** — Plugins can optionally inject custom macros into dbt project exports.
- **BREAKING**: `POST /api/uploads` currently validates `.csv` only. After this change, it accepts any extension registered by a plugin.

## Capabilities

### New Capabilities
- `file-format-plugin-interface`: Protocol definition, plugin lifecycle (validate, process, schema hints, default transforms, dbt macros, chat guidance), and the registry that discovers/loads plugins at startup.
- `file-format-interactive-processing`: Model for plugins to declare user choices needed during processing, and how the platform mediates those choices through the chat interface (Excel sheet selection, FHIR resource type selection).
- `plugin-csv`: CSV plugin — reference implementation extracted from current inline processing. Serves as living documentation for plugin developers.
- `plugin-excel`: Excel plugin — `.xlsx`/`.xls` support with multi-sheet selection via chat.
- `plugin-hl7v2`: HL7v2 plugin — `.hl7` message parsing, segment flattening to tabular columns.
- `plugin-fhir`: FHIR plugin — `.json`/`.ndjson` bundle parsing, resource type selection, nested resource flattening.

### Modified Capabilities
- `dbt-project-generation`: Plugin-contributed dbt macros must be included in the generated `macros/` directory. The `generate_macros_sql()` function currently only emits hardcoded DuckDB utility macros.
- `dbt-export-api`: No behavioral change to the API contract, but the export must work correctly for datasets created by any plugin (not just CSV). Verify compatibility.

## Impact

### Backend
- **New package**: `backend/app/plugins/` — protocol, registry, built-in plugins (csv, excel, hl7v2, fhir)
- **Modified**: `backend/app/use_cases/upload/upload_file.py` — remove hardcoded CSV validation, delegate to plugin registry
- **Modified**: `backend/app/use_cases/dataset/_pipeline/ingestion.py` — replace `parse_and_clean_csv` with plugin.process(), pass through schema hints
- **Modified**: `backend/app/use_cases/dataset/create_dataset_from_upload.py` — support interactive processing (multi-step with user choices)
- **Modified**: `backend/app/use_cases/project/_dbt/macros_sql.py` — collect macros from plugins via registry
- **Modified**: `backend/app/utils/csv_parser.py` — logic moves into CsvPlugin (file may be removed or kept as internal util)
- **New endpoint**: Route to expose registered formats/extensions to frontend (e.g., `GET /api/formats`)
- **New dependencies**: `openpyxl` (Excel), `hl7apy` or similar (HL7v2), `fhir.resources` or manual parsing (FHIR)

### Frontend
- **Modified**: `UploadWidget.tsx` — dynamic `accept` attribute from registered formats instead of hardcoded `.csv`
- **Modified**: Chat handling for interactive plugin choices (sheet selection, resource type selection)

### Worker
- No changes expected. Worker handles chat streaming, not file processing.

### Data model
- No schema migrations needed. Datasets created by plugins use the same `DatasetRecord` model — `schema_config`, `column_profiles`, `storage_path`, `transforms` all work identically regardless of source format.
- **Outbox event**: `UploadFileReceived` payload may gain a `format` or `plugin_id` field to track which plugin processed the file.

### New Python dependencies
- `openpyxl` — Excel file reading
- HL7v2 parsing library (evaluate `hl7apy` vs `python-hl7`)
- FHIR parsing (evaluate `fhir.resources` vs manual JSON extraction)
