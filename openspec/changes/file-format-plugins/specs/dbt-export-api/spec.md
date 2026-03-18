## ADDED Requirements

### Requirement: Plugin-Created Datasets Export Correctly

Datasets created by any registered file format plugin SHALL export correctly via the dbt export API. The export pipeline SHALL be format-agnostic — it operates on `schema_config`, `transforms`, and Parquet storage regardless of source format.

- Datasets created by Excel, HL7v2, or FHIR plugins SHALL appear in `sources.yml` with correct storage paths.
- Staging model SQL files SHALL be generated for plugin-created datasets using the same CTE pipeline logic.
- Column definitions in `schema.yml` SHALL reflect the `schema_config` stored at dataset creation time (which may include plugin schema hints).
- The zip archive SHALL be valid and buildable by dbt regardless of which plugins created the datasets.

#### Scenario: HL7v2 dataset exports to dbt
- **WHEN** a project contains a dataset created by the HL7v2 plugin with columns `msh_message_type`, `pid_patient_id`, `pid_patient_name`
- **THEN** `sources.yml` SHALL list the dataset with its storage path
- **THEN** `schema.yml` SHALL list the model with all three columns and their types
- **THEN** `stg_{dataset_name}.sql` SHALL be generated with the standard CTE pipeline

#### Scenario: Mixed-format project exports correctly
- **WHEN** a project contains one CSV dataset, one Excel dataset, and one FHIR dataset
- **THEN** all three SHALL appear in `sources.yml`
- **THEN** all three SHALL have staging model SQL files
- **THEN** the dbt project SHALL be structurally valid

#### Scenario: Plugin schema hints are reflected in export
- **WHEN** a FHIR dataset was created with `schema_hints={"birth_date": "datetime"}`
- **THEN** the `schema_config` SHALL record `birth_date` as `"datetime"`
- **THEN** `schema.yml` SHALL map `birth_date` to the appropriate dbt type
