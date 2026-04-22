## Purpose

Describes how FHIR R4 bundles are ingested: validated via `fhir.resources`, split by `resourceType`, and normalised into one dataset per resource type. It is the interoperability capability that turns clinical FHIR data into analytics-ready datasets.

## Requirements

### Requirement: FHIR R4 validated parsing

The FHIR plugin SHALL use the `fhir.resources` library to parse and validate FHIR R4 resources. Ad-hoc JSON traversal SHALL be replaced with typed Pydantic model parsing. The plugin SHALL reject input that does not conform to the FHIR R4 specification.

#### Scenario: Valid FHIR R4 Bundle is parsed successfully
- **WHEN** a file containing a valid FHIR R4 Bundle with Patient and Observation resources is uploaded
- **THEN** the plugin SHALL parse each resource entry using `fhir.resources` models
- **THEN** each resource SHALL be validated against the R4 schema

#### Scenario: Invalid FHIR resource is rejected
- **WHEN** a file contains a JSON object with `resourceType: "Patient"` but missing required fields
- **THEN** the plugin SHALL raise `PluginValidationError` with a message describing the validation failure

#### Scenario: Non-R4 FHIR version is rejected
- **WHEN** a file contains FHIR STU3 resources (detected by incompatible structure)
- **THEN** the plugin SHALL raise `PluginValidationError` indicating only R4 is supported

---

### Requirement: Resource type splitting into multiple datasets

The FHIR plugin SHALL split a Bundle into separate datasets by `resourceType`. Each distinct resource type in the Bundle SHALL produce its own `ProcessingResult` with an independent DataFrame.

#### Scenario: Bundle with two resource types produces two datasets
- **WHEN** a FHIR Bundle contains 10 Patient resources and 5 Observation resources
- **THEN** the plugin SHALL return a `MultiProcessingResult` with 2 items
- **THEN** one item SHALL have `name="Patient"` with a 10-row DataFrame
- **THEN** the other item SHALL have `name="Observation"` with a 5-row DataFrame

#### Scenario: Bundle with single resource type produces one dataset
- **WHEN** a FHIR Bundle contains only Patient resources
- **THEN** the plugin SHALL return a `MultiProcessingResult` with 1 item named `"Patient"`

#### Scenario: Resource type cap is enforced
- **WHEN** a FHIR Bundle contains more than 20 distinct resource types
- **THEN** the plugin SHALL raise `PluginValidationError` indicating the bundle exceeds the maximum resource type limit

---

### Requirement: FHIR resource flattening

Each FHIR resource SHALL be flattened to a tabular row using dot notation for one level of nesting. The flattening strategy SHALL produce consistent, predictable column names across resources of the same type.

#### Scenario: Top-level fields become columns
- **WHEN** a Patient resource has `id`, `gender`, `birthDate`
- **THEN** the DataFrame SHALL have columns `id`, `gender`, `birth_date` (snake_case)

#### Scenario: Nested objects use dot notation
- **WHEN** a Patient resource has `name[0].family = "Smith"` and `name[0].given[0] = "John"`
- **THEN** the DataFrame SHALL have columns `name.0.family` and `name.0.given.0`

#### Scenario: References are preserved as strings
- **WHEN** an Observation has `subject.reference = "Patient/123"`
- **THEN** the DataFrame column `subject.reference` SHALL contain the string `"Patient/123"`

#### Scenario: Schema hints for known FHIR types
- **WHEN** a resource contains date fields (`birthDate`), boolean fields (`active`), or numeric fields (`value`)
- **THEN** the `ProcessingResult.schema_hints` SHALL map these columns to `"date"`, `"boolean"`, or `"number"` respectively

---

### Requirement: FHIR NDJSON support

The plugin SHALL accept both standard JSON (Bundle) and NDJSON (one resource per line) input formats.

#### Scenario: NDJSON file with mixed resource types
- **WHEN** a `.ndjson` file contains Patient and Condition resources (one JSON object per line)
- **THEN** the plugin SHALL group resources by type and produce a `MultiProcessingResult`
- **THEN** processing SHALL be identical to Bundle-based input

#### Scenario: Standard JSON Bundle
- **WHEN** a `.json` file contains a FHIR Bundle with `resourceType: "Bundle"` and an `entry` array
- **THEN** the plugin SHALL extract resources from `entry[].resource` and process normally

---

### Requirement: FHIR chat guidance per resource type

Each `ProcessingResult` item in the multi-dataset output SHALL include `chat_guidance` describing the resource type's structure, common fields, and relationship to other resources in the same upload.

#### Scenario: Patient dataset includes guidance
- **WHEN** a Patient dataset is produced from a FHIR Bundle
- **THEN** the `chat_guidance` SHALL describe Patient resource fields and note which other resource types in the upload reference Patient
