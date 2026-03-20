## Why

The FHIR and HL7v2 plugins were scaffolded as part of the file format plugin system but use ad-hoc parsing that doesn't handle real-world healthcare data correctly. FHIR bundles contain heterogeneous resource types that must be normalized into separate datasets, and HL7v2 messages should be converted to FHIR via Mirth Connect before normalization — neither of which the current single-dataset-per-upload pipeline supports.

## What Changes

- **FHIR plugin**: Replace ad-hoc JSON flattening with `fhir.resources` library for validated FHIR R4 model parsing
- **FHIR multi-dataset output**: One FHIR bundle upload produces multiple datasets (one per resource type: Patient, Observation, Condition, etc.), each linked back to the original upload
- **HL7v2 plugin**: Convert from 2-phase to 3-phase upload (receive raw HL7v2 → convert via Mirth Connect to FHIR → normalize via FHIR plugin pipeline)
- **HL7v2 artifact persistence**: Both raw HL7v2 and converted FHIR bundle are stored under the same upload record
- **Plugin protocol**: `ProcessingResult` must support returning multiple DataFrames (one per resource type / output dataset)
- **Upload model**: New fields to track conversion artifacts (raw + converted storage paths) and link one upload to many datasets
- **BREAKING**: `ProcessingResult.df` changes from a single DataFrame to a multi-dataset return type
- **BREAKING**: `create_dataset_from_upload` must handle one upload producing multiple datasets

## Capabilities

### New Capabilities
- `fhir-multi-dataset-normalization`: FHIR bundle parsing with `fhir.resources`, resource type splitting, and multi-dataset output from a single upload
- `hl7v2-mirth-conversion`: 3-phase HL7v2 upload pipeline with Mirth Connect integration for HL7v2-to-FHIR conversion and dual artifact storage
- `multi-dataset-upload`: Generalizing the upload-to-dataset pipeline to support one upload producing multiple datasets

### Modified Capabilities
- `file-format-plugin-interface`: `ProcessingResult` gains a multi-dataset return type; `FileFormatPlugin.process()` contract changes

## Impact

- **Backend plugins**: `fhir_plugin.py`, `hl7v2_plugin.py`, `protocol.py` — rewritten
- **Backend use cases**: `create_dataset_from_upload.py`, `upload_file.py` — modified to handle multi-dataset output
- **Backend models**: `upload.py` — new fields for conversion artifacts and multi-dataset linkage
- **Backend routers**: `uploads.py` — response shape changes for multi-dataset uploads
- **Database**: Alembic migration for Upload model changes (new columns)
- **Dependencies**: Add `fhir.resources` to `backend/pyproject.toml`; Mirth Connect HTTP client integration
- **Frontend**: Upload progress UI must handle one upload producing multiple datasets
- **Outbox**: Events must support multi-dataset creation from single upload
