## ADDED Requirements

### Requirement: One upload produces multiple datasets

The `create_dataset_from_upload` use case SHALL support plugins that return `MultiProcessingResult`, creating one dataset per item in the result.

#### Scenario: Multi-dataset creation from FHIR upload
- **WHEN** a plugin returns `MultiProcessingResult` with 3 items (Patient, Observation, Condition)
- **THEN** `create_dataset_from_upload` SHALL create 3 separate datasets
- **THEN** each dataset SHALL have its own Parquet files, schema config, and metadata record
- **THEN** all 3 dataset IDs SHALL be linked to the upload record via `dataset_ids`

#### Scenario: Single-dataset plugins unchanged
- **WHEN** a plugin returns a standard `ProcessingResult` (e.g., CSV plugin)
- **THEN** `create_dataset_from_upload` SHALL create exactly one dataset
- **THEN** behavior SHALL be identical to the current implementation

#### Scenario: Atomic multi-dataset creation
- **WHEN** a plugin returns `MultiProcessingResult` with 3 items and dataset creation fails on the 2nd item
- **THEN** no datasets SHALL be committed (all-or-nothing within the transaction)
- **THEN** the upload SHALL be marked with status `"error"` and an error message

---

### Requirement: Upload model supports multiple datasets

The Upload model SHALL track multiple dataset IDs and optional conversion artifacts.

#### Scenario: Upload with multiple datasets
- **WHEN** an upload produces 3 datasets
- **THEN** `upload.dataset_ids` SHALL contain all 3 dataset IDs
- **THEN** `upload.dataset_id` SHALL return the first dataset ID for backward compatibility

#### Scenario: Upload with conversion artifact
- **WHEN** an HL7v2 upload is converted to FHIR
- **THEN** `upload.raw_storage_path` SHALL point to the original HL7v2 file
- **THEN** `upload.converted_storage_path` SHALL point to the FHIR bundle

#### Scenario: Upload serialization includes new fields
- **WHEN** `upload.serialize()` is called on a multi-dataset upload
- **THEN** the output SHALL include `dataset_ids` as a list of strings
- **THEN** the output SHALL include `converted_storage_path` if present
- **THEN** the output SHALL still include `dataset_id` for backward compatibility

---

### Requirement: Alembic migration for upload model changes

An Alembic migration SHALL add the new columns to the upload/outbox storage.

#### Scenario: Migration adds new columns
- **WHEN** the migration runs
- **THEN** the outbox payload schema SHALL support `converted_storage_path` (nullable string)
- **THEN** the outbox payload schema SHALL support `dataset_ids` (nullable JSON array)

#### Scenario: Migration is backward compatible
- **WHEN** the migration runs against a database with existing upload records
- **THEN** existing records SHALL have `converted_storage_path = NULL` and `dataset_ids = NULL`
- **THEN** existing records SHALL continue to function with the `dataset_id` field

---

### Requirement: Upload API response for multi-dataset uploads

The upload API response SHALL communicate multi-dataset results to the frontend.

#### Scenario: Multi-dataset upload response
- **WHEN** `create_dataset_from_upload` completes with 3 datasets
- **THEN** the API response SHALL include `dataset_ids: ["id1", "id2", "id3"]`
- **THEN** the API response SHALL include `dataset_id: "id1"` for backward compatibility

#### Scenario: Upload status reflects multi-dataset processing
- **WHEN** a multi-dataset upload is in progress
- **THEN** `upload.status` SHALL be `"processing"`
- **WHEN** all datasets are created successfully
- **THEN** `upload.status` SHALL be `"completed"`

---

### Requirement: Outbox events for multi-dataset uploads

The outbox SHALL emit events for each dataset created from a multi-dataset upload.

#### Scenario: Multiple dataset-created events
- **WHEN** an upload produces 3 datasets
- **THEN** 3 separate dataset-created outbox events SHALL be emitted
- **THEN** each event SHALL reference both the dataset ID and the originating upload ID
