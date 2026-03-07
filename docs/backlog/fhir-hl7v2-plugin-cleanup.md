# Clean Up FHIR and HL7v2 Plugins

## Context

The FHIR and HL7v2 plugins were scaffolded as part of the file format plugin system but need significant rework to handle real-world data correctly.

## 1. FHIR Plugin — Standards-compliant parsing with multi-table normalization

**File**: `backend/app/plugins/fhir_plugin.py`

Replace current ad-hoc parsing with the `fhir.resources` library (PyPI) for validated FHIR R4 model parsing. This plugin produces **multiple datasets per upload** — FHIR bundles contain heterogeneous resource types (Patient, Observation, Condition, etc.) that must be normalized into separate tables.

- Each resource type becomes its own dataset, linked back to the original upload
- The ingestion pipeline and `create_dataset_from_upload` must support one upload → many datasets
- Handle nested references between resources (e.g., Observation.subject → Patient)
- Add `fhir.resources` to `backend/pyproject.toml`

## 2. HL7v2 Plugin — 3-phase upload via Mirth Connect

**File**: `backend/app/plugins/hl7v2_plugin.py`

Convert from a 2-phase to a **3-phase** upload process:

1. **Phase 1 — Receive**: Accept raw HL7v2 message, store it in S3
2. **Phase 2 — Convert**: Send to Mirth Connect for HL7v2 → FHIR conversion, store the resulting FHIR bundle in S3 (same upload request stores both raw HL7v2 and converted FHIR)
3. **Phase 3 — Normalize**: Pass converted FHIR bundle through the FHIR plugin's normalization pipeline → create datasets as normal

Both the raw HL7v2 and the FHIR conversion must be persisted under the same upload record. Mirth Connect integration needs a connection strategy (HTTP API call, queue, etc.).

## Shared Concerns

- Upload model may need additional fields to track conversion artifacts (raw + converted)
- The "one upload → many datasets" pattern affects outbox events, upload status tracking, and frontend upload progress UI
- Plugin protocol (`backend/app/plugins/protocol.py`) may need a multi-dataset return type
- Add/update Alembic migration if upload or dataset models change

## Files Likely Affected

- `backend/app/plugins/fhir_plugin.py`
- `backend/app/plugins/hl7v2_plugin.py`
- `backend/app/plugins/protocol.py`
- `backend/app/use_cases/dataset/create_dataset_from_upload.py`
- `backend/app/use_cases/upload/upload_file.py`
- `backend/app/routers/uploads.py`
- `backend/app/models/upload.py`
- `backend/pyproject.toml`
