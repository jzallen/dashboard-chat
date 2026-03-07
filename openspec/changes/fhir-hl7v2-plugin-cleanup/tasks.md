## 1. Plugin Protocol — Multi-Dataset Return Type

- [x] 1.1 Add `name: str | None = None` field to `ProcessingResult` in `backend/app/plugins/protocol.py`
- [x] 1.2 Create `MultiProcessingResult` dataclass with `results: list[ProcessingResult]` and `chat_guidance: str | None` in `protocol.py`
- [x] 1.3 Add `__post_init__` validation on `MultiProcessingResult`: reject empty `results` list and unnamed items
- [x] 1.4 Update `FileFormatPlugin.process()` return type annotation to `ProcessingResult | MultiProcessingResult`
- [x] 1.5 Add unit tests for `MultiProcessingResult` validation (empty list, unnamed items, valid construction)

## 2. FHIR Plugin — Validated R4 Parsing

- [x] 2.1 Add `fhir.resources` to `backend/pyproject.toml` and run `uv lock`
- [x] 2.2 Rewrite `FhirPlugin.validate()` to parse input with `fhir.resources` Bundle/resource models and reject non-R4 content
- [x] 2.3 Rewrite `FhirPlugin.process()` to use `fhir.resources` models for resource extraction from Bundle and NDJSON formats
- [x] 2.4 Implement resource type splitting: group resources by `resourceType`, produce one `ProcessingResult` per type
- [x] 2.5 Implement FHIR resource flattening: dot notation for nested objects, indexed keys for arrays, snake_case column names
- [x] 2.6 Generate `schema_hints` for known FHIR date/boolean/numeric fields per resource type
- [x] 2.7 Generate per-resource-type `chat_guidance` describing fields and cross-resource references
- [x] 2.8 Return `MultiProcessingResult` from `process()` with named items and overall guidance
- [x] 2.9 Enforce resource type cap (max 20 distinct types per bundle)
- [x] 2.10 Update unit tests: valid R4 Bundle, multi-type Bundle, NDJSON input, invalid FHIR, resource type cap exceeded

## 3. HL7v2 Plugin — 3-Phase Upload with Mirth Connect

- [x] 3.1 Add Mirth Connect configuration to `backend/app/config.py` (`MIRTH_CONNECT_URL`, `MIRTH_CONNECT_API_KEY`, timeout)
- [x] 3.2 Create Mirth Connect HTTP client utility (send HL7v2, receive FHIR bundle, handle errors/timeouts)
- [x] 3.3 Rewrite `Hl7v2Plugin.validate()` to check MSH segments and verify Mirth Connect configuration is present
- [x] 3.4 Rewrite `Hl7v2Plugin.process()` to implement 3-phase pipeline: validate → convert via Mirth → normalize via FHIR plugin
- [x] 3.5 Ensure `process()` returns `MultiProcessingResult` (delegated from FHIR plugin normalization)
- [x] 3.6 Add unit tests with mocked Mirth Connect: successful conversion, unreachable service, error response, timeout
- [x] 3.7 Add Mirth Connect to `docker-compose.yml` under a `healthcare` profile

## 4. Upload Model — Multi-Dataset and Conversion Artifacts

- [x] 4.1 Add `converted_storage_path: str | None` field to `Upload` model in `backend/app/models/upload.py`
- [x] 4.2 Add `dataset_ids: list[str]` field to `Upload` model, keep `dataset_id` for backward compatibility
- [x] 4.3 Update `Upload.serialize()` to include `converted_storage_path` and `dataset_ids`
- [x] 4.4 Update `Upload.from_outbox_record()` to handle new fields
- [x] 4.5 Create Alembic migration for outbox payload schema changes (nullable `converted_storage_path`, nullable `dataset_ids` JSON)
- [x] 4.6 Add unit tests for Upload model serialization with new fields

## 5. Upload Use Case — Multi-Dataset Creation

- [x] 5.1 Update `create_dataset_from_upload` to check `process()` return type (`ProcessingResult` vs `MultiProcessingResult`)
- [x] 5.2 Implement multi-dataset branch: loop over `MultiProcessingResult.results`, create dataset + Parquet per item
- [x] 5.3 Link all created dataset IDs to the upload record via `dataset_ids`
- [x] 5.4 Ensure atomic transaction: if any dataset creation fails, roll back all datasets
- [x] 5.5 Emit per-dataset outbox events for multi-dataset uploads
- [x] 5.6 Update `upload_file` to store `converted_storage_path` when the plugin provides a conversion artifact
- [x] 5.7 Add unit tests: single-dataset plugin (unchanged behavior), multi-dataset plugin, partial failure rollback

## 6. Upload API — Response Shape

- [x] 6.1 Update upload router response to include `dataset_ids` and `converted_storage_path`
- [x] 6.2 Ensure `dataset_id` remains in response for backward compatibility (first dataset ID)
- [x] 6.3 Add integration test: upload FHIR bundle → verify multi-dataset response shape

## 7. Infrastructure and Dependencies

- [x] 7.1 Add `fhir.resources` to `backend/pyproject.toml` runtime dependencies
- [x] 7.2 Add `httpx` (if not already present) for Mirth Connect HTTP client
- [x] 7.3 Add Mirth Connect service to `docker-compose.yml` under `healthcare` profile with health check
- [x] 7.4 Add `MIRTH_CONNECT_URL` and `MIRTH_CONNECT_API_KEY` to `.devcontainer/devcontainer.json` environment (empty defaults)

## 8. End-to-End Tests

- [x] 8.1 E2E test: upload FHIR R4 Bundle → verify multiple datasets created with correct resource types
- [x] 8.2 E2E test: upload HL7v2 file with mocked Mirth Connect → verify FHIR conversion → multi-dataset output
- [x] 8.3 E2E test: upload CSV file → verify single-dataset behavior unchanged
- [x] 8.4 E2E test: verify Upload API response includes `dataset_ids` for multi-dataset upload
