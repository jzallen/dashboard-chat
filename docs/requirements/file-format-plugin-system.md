# File Format Plugin System — Requirements

**Status:** Draft
**Author:** Business Analyst
**Audience:** Solutions Architect, Development Team
**Feature Spec:** `features/file-format-plugins.feature`

## Problem Statement

The platform currently only supports CSV file uploads. Users working with healthcare data (HL7v2 messages, FHIR bundles) and common business formats (Excel) cannot use the platform without manual conversion to CSV. This creates friction and limits adoption in healthcare and enterprise environments.

We need a plugin system that allows developers to extend the platform with custom file format processors, so that new formats can be added without modifying core platform code.

## Business Goals

1. **Extensibility** — Third-party or internal developers can add new file formats without forking or modifying core code
2. **Data lake conformance** — All plugins produce output that integrates with the existing Parquet-based data lake and dbt export pipeline
3. **Consistent UX** — Regardless of input format, users get the same chat-driven table experience (filter, sort, add, delete)
4. **Healthcare readiness** — Support HL7v2 and FHIR as first-class formats for healthcare data workflows

## Target Formats (Initial)

| Format | Extensions | Notes |
|--------|-----------|-------|
| CSV | `.csv` | Already supported; refactor into a plugin as the reference implementation |
| Excel | `.xlsx`, `.xls` | Multi-sheet support with user selection |
| HL7v2 | `.hl7`, `.txt` | Pipe-delimited segment/field format; flatten to tabular |
| FHIR | `.json`, `.ndjson` | JSON bundles with typed resources; one resource type per dataset |

## Functional Requirements

### FR-1: Plugin Registry

- The platform maintains a registry of file format plugins
- Plugins are discovered and loaded at startup
- Each plugin declares which file extensions it handles
- The built-in CSV processor is refactored into the first plugin (reference implementation)
- Conflicting extension registrations (two plugins claiming `.json`) must be resolved explicitly

### FR-2: FileFormatPlugin Interface

Each plugin must implement a contract that provides:

- **Supported extensions** — Which file extensions this plugin handles
- **Validation** — Accept/reject a file with a user-facing error message
- **Processing** — Convert raw file bytes into a tabular DataFrame with typed columns
- **Schema hints** (optional) — Provide explicit column type mappings that override default inference
- **Default transforms** (optional) — Cleaning transforms to apply automatically to new datasets
- **dbt macros** (optional) — Custom macros to include in dbt project exports
- **Chat guidance** (optional) — Format-specific context for the AI assistant after dataset creation

### FR-3: Interactive Processing

Some formats require user input during processing:

- **Excel** — User selects which sheet to import when multiple sheets exist
- **FHIR** — User selects which resource type to extract when a bundle contains multiple types

These interactions happen through the existing chat interface. The plugin declares what choices are needed, and the platform handles the chat UX.

### FR-4: Data Lake Conformance

Regardless of input format, the processing pipeline must produce:

1. A tabular DataFrame (rows and typed columns)
2. Partitioned Parquet files written to the data lake (S3/MinIO)
3. A `schema_config` with column definitions
4. Column profiles (distributions, nulls, etc.)
5. A 10-row preview for the UI

The platform handles steps 2-5 generically. The plugin is only responsible for step 1 (and optionally overriding type inference in step 3).

### FR-5: dbt Export Compatibility

- Datasets created by any plugin export correctly via `GET /api/projects/{id}/export/dbt`
- The staging SQL, sources.yml, and schema.yml generation works identically regardless of source format
- Plugins may optionally contribute custom dbt macros (e.g., HL7v2 segment parsing helpers)

### FR-6: Error Handling

- Plugin validation errors surface as user-friendly messages in the chat
- Processing failures do not create partial datasets
- The upload widget shows a "Retry" button on failure (existing pattern)
- Plugin errors are distinguishable from platform errors in logs

### FR-7: Upload UX

- The upload dialog dynamically shows all supported file extensions from registered plugins
- File extension determines which plugin processes the upload
- The rest of the upload flow (widget states, navigation, rename) remains identical to current CSV behavior
- Natural language upload requests ("upload my patient data") work with any registered format

## Non-Functional Requirements

### NFR-1: Isolation
Plugins must not be able to interfere with each other or with core platform stability. A failing plugin should not bring down the upload flow for other formats.

### NFR-2: Testability
The plugin interface should be testable in isolation — developers can unit test their plugin without running the full platform.

### NFR-3: Discoverability
It should be straightforward for a developer to understand how to create a plugin. The CSV plugin serves as the reference implementation and living documentation.

### NFR-4: Multi-tenancy
Plugins operate within the existing org_id scoping. Plugin-created datasets are org-scoped like any other dataset. Plugins do not have access to data outside the current organization context.

### NFR-5: Performance
Large file processing (Excel files with 100k+ rows, large FHIR bundles) should not block the API. Processing should be async with progress feedback where possible.

## Out of Scope

- **Plugin marketplace or distribution** — Plugins are code-level extensions, not installable packages (for now)
- **Frontend-only plugins** — All processing happens server-side; plugins are backend-only
- **Streaming/incremental ingestion** — Plugins process complete files, not streams
- **Format auto-detection** — We rely on file extension, not content sniffing
- **Plugin versioning or hot-reload** — Plugins are loaded at startup; changes require restart

## Existing Patterns to Leverage

The codebase already has patterns that align with a plugin architecture:

1. **AuthProvider Protocol** — Protocol-based interface with factory selection (`backend/app/auth/provider.py`). The FileFormatPlugin interface should follow this pattern.
2. **LakeRepository Protocol** — Storage abstraction with swappable implementations. Plugins produce data; the platform handles storage through this existing interface.
3. **Outbox events** — The upload flow already uses event sourcing (`FileReceived` event). Plugin processing could emit format-specific events.
4. **Repository overrides** — The `RepositoryContainer` supports dependency injection and overrides, which may inform how plugins receive platform services.

## User Stories

### US-1: Excel Upload
> As a business analyst, I want to upload an Excel file and select a sheet, so that I can work with spreadsheet data without converting to CSV first.

**Acceptance criteria:**
- Upload dialog accepts `.xlsx` and `.xls` files
- If the file has one sheet, it imports directly
- If the file has multiple sheets, chat prompts me to choose
- The resulting dataset is fully functional (filter, sort, add, delete, dbt export)

### US-2: HL7v2 Upload
> As a healthcare data engineer, I want to upload HL7v2 message files, so that I can explore and clean clinical data in a tabular format.

**Acceptance criteria:**
- Upload dialog accepts `.hl7` files
- HL7v2 segments are flattened into columns (e.g., PID-3 → patient_id, PID-5 → patient_name)
- The resulting dataset is queryable via chat and exports to dbt

### US-3: FHIR Upload
> As a healthcare data engineer, I want to upload FHIR bundles and select a resource type, so that I can work with structured clinical data.

**Acceptance criteria:**
- Upload dialog accepts `.json` FHIR bundles
- If multiple resource types exist, chat prompts me to choose
- Resources are flattened into columns appropriate for the selected type
- The resulting dataset is queryable via chat and exports to dbt

### US-4: Developer Creates a Plugin
> As a platform developer, I want to create a custom file format plugin, so that I can support my organization's proprietary data format.

**Acceptance criteria:**
- A documented plugin interface exists with clear method signatures
- The CSV plugin serves as a working reference implementation
- I can unit test my plugin in isolation
- Registering my plugin makes its format available in the upload dialog

## Open Questions for Solutions Architect

1. **Plugin discovery mechanism** — File-based scanning, explicit registration in config, or Python entry points?
2. **Interactive processing model** — How should the plugin declare "I need user input" in a way that the chat UX can generically handle? Callback? Coroutine yield? State machine?
3. **File extension conflicts** — If two plugins both claim `.json` (e.g., FHIR and a generic JSON plugin), how is priority resolved?
4. **Processing timeout/resource limits** — Should the platform enforce limits on plugin processing time or memory usage?
5. **Plugin access to platform services** — Should plugins receive a context object with access to platform services (e.g., LakeRepository), or should they be pure functions that only return data?
