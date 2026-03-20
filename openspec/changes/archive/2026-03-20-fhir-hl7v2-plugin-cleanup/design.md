## Context

The file format plugin system (`backend/app/plugins/`) currently assumes a 1:1 relationship between uploads and datasets. The `FileFormatPlugin.process()` method returns a single `ProcessingResult` containing one `pd.DataFrame`, and `create_dataset_from_upload` creates exactly one dataset per upload.

Real-world FHIR bundles contain multiple resource types (Patient, Observation, Condition, etc.) that must be normalized into separate tables. The current FHIR plugin does ad-hoc JSON flattening without validation. HL7v2 messages in production environments are typically converted to FHIR via integration engines like Mirth Connect before normalization.

### Current flow
```
Upload → Plugin.process() → single DataFrame → single Dataset
```

### Target flow
```
Upload → Plugin.process() → MultiProcessingResult (N DataFrames) → N Datasets
                                   ↑
HL7v2 Upload → store raw → Mirth Convert → FHIR bundle → FHIR Plugin pipeline
```

## Goals / Non-Goals

**Goals:**
- Replace ad-hoc FHIR parsing with validated `fhir.resources` R4 models
- Support one upload producing multiple datasets (one per FHIR resource type)
- Introduce Mirth Connect integration for HL7v2 → FHIR conversion
- Preserve raw HL7v2 alongside converted FHIR under the same upload record
- Maintain backward compatibility for CSV and Excel plugins (single-dataset path)

**Non-Goals:**
- Streaming/incremental FHIR processing for very large bundles (batch is sufficient)
- Supporting FHIR versions other than R4
- Building a general-purpose ETL pipeline — this is specific to healthcare format normalization
- Real-time HL7v2 message feeds (this handles file uploads only)
- Frontend redesign — minimal UI changes to show multi-dataset upload results

## Decisions

### 1. Multi-dataset return type via `MultiProcessingResult`

**Decision**: Add a new `MultiProcessingResult` dataclass alongside the existing `ProcessingResult`. Plugins that produce multiple datasets return `MultiProcessingResult` (a list of named `ProcessingResult` items). The `process()` return type becomes `ProcessingResult | MultiProcessingResult`.

**Alternatives considered**:
- *Modify `ProcessingResult` to hold `list[DataFrame]`*: Breaks all existing plugins and tests. Every consumer must handle the list case.
- *Return a dict of DataFrames*: Loses the typed metadata (schema_hints, chat_guidance) per dataset.

**Rationale**: A union return type is backward-compatible. Existing plugins return `ProcessingResult` unchanged. Only the platform dispatch layer (`create_dataset_from_upload`) needs to check which type was returned and branch accordingly.

### 2. FHIR parsing via `fhir.resources`

**Decision**: Use the `fhir.resources` PyPI package for FHIR R4 model parsing and validation. Each resource in a Bundle is parsed into its typed model, then flattened to a DataFrame.

**Alternatives considered**:
- *Manual JSON traversal*: Current approach — fragile, no validation, misses edge cases.
- *`fhirclient`*: Older library, less maintained, heavier dependency.

**Rationale**: `fhir.resources` is the most actively maintained Python FHIR library, provides Pydantic models for all R4 resource types, and validates structure on parse. It handles nested references, extensions, and codeable concepts correctly.

### 3. Mirth Connect integration via HTTP API

**Decision**: The HL7v2 plugin calls Mirth Connect's HTTP API to convert HL7v2 messages to FHIR R4 bundles. The connection is configured via environment variables (`MIRTH_CONNECT_URL`, `MIRTH_CONNECT_API_KEY`). The call is synchronous within the plugin's `process()` method (which already runs in `asyncio.to_thread()`).

**Alternatives considered**:
- *Message queue (RabbitMQ/Redis)*: Adds infrastructure complexity for what is a synchronous request-response operation.
- *Embedded HL7v2-to-FHIR converter in Python*: No mature Python library exists; Java-based converters (HAPI) are the standard.

**Rationale**: Mirth Connect is the industry standard for healthcare integration. HTTP API keeps the architecture simple — the plugin makes a request and gets back a FHIR bundle. Queue-based approaches add latency and complexity without benefit for file uploads.

### 4. Upload model changes for multi-dataset and dual artifacts

**Decision**: Extend the Upload model with:
- `converted_storage_path: str | None` — path to converted artifact (FHIR bundle from HL7v2 conversion)
- `dataset_ids: list[str]` — replaces single `dataset_id` field

The existing `dataset_id` field is kept for backward compatibility but deprecated. New code uses `dataset_ids`. An Alembic migration adds the new columns.

**Alternatives considered**:
- *Separate UploadArtifact table*: Over-normalized for two artifacts (raw + converted).
- *JSON blob for artifacts*: Loses queryability.

**Rationale**: Two explicit columns (raw + converted path) are simple and sufficient. The `dataset_ids` list handles the 1:N upload-to-dataset relationship without a join table, since uploads are read as a unit.

### 5. `create_dataset_from_upload` dispatch logic

**Decision**: After calling `plugin.process()`, the use case checks the return type:
- `ProcessingResult` → existing single-dataset path (unchanged)
- `MultiProcessingResult` → loop over items, create one dataset per item, link all to the upload

Each dataset in the multi-dataset case gets its own Parquet files, schema config, and metadata record. The upload is marked processed only after all datasets are created successfully (atomic — if any fails, none are committed).

### 6. FHIR resource flattening strategy

**Decision**: Flatten each FHIR resource to one level of nesting using dot notation (e.g., `name.family`, `address.city`). Arrays are expanded with indexed keys (e.g., `identifier.0.value`, `identifier.1.value`). References are kept as string references (e.g., `Patient/123`).

**Rationale**: One level of nesting balances readability with data preservation. Deeper nesting creates unusable column counts. Cross-resource references are preserved as strings — join logic is left to the user via chat/SQL.

## Risks / Trade-offs

- **[Mirth Connect availability]** → The HL7v2 plugin fails if Mirth Connect is unreachable. Mitigation: Health check at startup, clear error messages, configurable timeout. Consider a "store and retry" pattern for production.
- **[Large FHIR bundles]** → Bundles with thousands of resources could produce many datasets. Mitigation: Cap at a configurable max resource types per upload (default 20). Warn user if bundle exceeds cap.
- **[Breaking ProcessingResult contract]** → Union return type requires all consumers to handle both cases. Mitigation: Only one consumer (`create_dataset_from_upload`) dispatches on type. All other code receives `ProcessingResult` per-dataset.
- **[Migration complexity]** → Upload model changes require Alembic migration and data backfill for existing uploads. Mitigation: New columns are nullable, existing data works without backfill. `dataset_id` kept for backward compat.
- **[Mirth Connect in dev environment]** → Developers need Mirth Connect running locally. Mitigation: Add to docker-compose with a `healthcare` profile. HL7v2 tests mock the Mirth HTTP call.

## Open Questions

1. Should the FHIR plugin support FHIR STU3 in addition to R4, or is R4-only sufficient for now?
2. What is the exact Mirth Connect API contract for HL7v2-to-FHIR conversion? (Endpoint path, auth mechanism, response format)
3. Should multi-dataset uploads show as a single item or expanded items in the frontend upload list?
