## ADDED Requirements

### Requirement: FhirPlugin Implementation

The system SHALL provide a `FhirPlugin` class in `backend/app/plugins/fhir_plugin.py` that implements the `FileFormatPlugin` protocol for FHIR bundle files.

- `name` SHALL be `"fhir"`.
- `extensions` SHALL be `[".ndjson", ".fhir.json"]`.
- `validate()` SHALL reject files that are not valid JSON or NDJSON, or that do not contain FHIR resources.
- `process()` SHALL extract resources of the selected type and flatten them into a tabular DataFrame.

#### Scenario: Valid FHIR NDJSON bundle is processed
- **WHEN** an `.ndjson` file containing FHIR Patient resources is uploaded
- **THEN** `process()` SHALL return a `ProcessingResult` with one row per Patient resource

#### Scenario: Invalid JSON is rejected
- **WHEN** a file with `.ndjson` extension that contains malformed JSON is uploaded
- **THEN** `validate()` SHALL raise `PluginValidationError` with message indicating invalid JSON format

#### Scenario: File with no FHIR resources is rejected
- **WHEN** a `.fhir.json` file contains valid JSON but no `resourceType` fields
- **THEN** `validate()` SHALL raise `PluginValidationError` with message "No FHIR resources found in file"

---

### Requirement: FHIR Resource Type Selection

When a FHIR bundle contains multiple resource types, the plugin SHALL require the user to select which type to extract via the interactive processing model.

- `detect_choices()` SHALL scan the bundle for distinct `resourceType` values.
- If all resources are the same type, `detect_choices()` SHALL return `None`.
- If multiple types exist, `detect_choices()` SHALL return a `PluginChoice` with `key="resource_type"` and options listing the distinct types.
- `process()` SHALL extract only resources matching `choices["resource_type"]`.

#### Scenario: Bundle with single resource type processes directly
- **WHEN** a FHIR bundle contains only Patient resources
- **THEN** `detect_choices()` SHALL return `None`
- **THEN** `process()` SHALL extract all Patient resources

#### Scenario: Bundle with multiple resource types prompts selection
- **WHEN** a FHIR bundle contains Patient, Observation, and Encounter resources
- **THEN** `detect_choices()` SHALL return `[PluginChoice(key="resource_type", label="Select a resource type to import", options=["Patient", "Observation", "Encounter"])]`

#### Scenario: User selects Patient resources from mixed bundle
- **WHEN** `process()` is called with `choices={"resource_type": "Patient"}`
- **THEN** the resulting DataFrame SHALL contain only Patient resources
- **THEN** Observation and Encounter resources SHALL be excluded

---

### Requirement: FHIR Resource Flattening

The plugin SHALL flatten FHIR resources into a tabular structure with columns derived from resource fields. Nested objects SHALL be flattened to one level of depth using dot-notation.

- Top-level primitive fields (e.g., `id`, `gender`, `birthDate`) SHALL become direct columns.
- Top-level array fields with primitives (e.g., `name[0].given[0]`) SHALL be flattened to `name_given` using the first element.
- Nested objects one level deep (e.g., `name[0].family`) SHALL become `name_family`.
- The `resourceType` field SHALL be included as a column.
- Deeply nested structures (beyond one level) SHALL be serialized as JSON strings.
- The flattening schema SHALL be consistent across all resources of the same type in a bundle.

#### Scenario: Patient resource is flattened to columns
- **WHEN** a FHIR Patient resource with `id`, `gender`, `birthDate`, and `name[0].family` is processed
- **THEN** the DataFrame row SHALL include columns `id`, `gender`, `birth_date`, `name_family`
- **THEN** column names SHALL use snake_case

#### Scenario: Missing optional fields become null
- **WHEN** a Patient resource lacks the optional `telecom` field
- **THEN** the `telecom` column (if present in other resources) SHALL be `None` for that row

#### Scenario: Nested arrays are serialized
- **WHEN** a resource has a deeply nested field like `name[0].given[1]`
- **THEN** values beyond the first nesting level SHALL be serialized as JSON strings

---

### Requirement: FHIR Plugin Provides Schema Hints

The plugin SHALL return `schema_hints` for known FHIR resource field types to improve type inference.

- `birthDate` and other FHIR date fields SHALL be hinted as `"datetime"`.
- Boolean fields (e.g., `active`, `deceasedBoolean`) SHALL be hinted as `"boolean"`.
- Numeric fields SHALL be hinted as `"number"`.
- All other fields SHALL default to `"text"`.

#### Scenario: FHIR date fields get datetime type
- **WHEN** a Patient resource with `birthDate` is processed
- **THEN** `ProcessingResult.schema_hints` SHALL include `{"birth_date": "datetime"}`

---

### Requirement: FHIR Plugin Provides Chat Guidance

The plugin SHALL return `chat_guidance` describing the FHIR resource structure to help the AI assistant.

- The guidance SHALL identify the resource type extracted.
- The guidance SHALL list the main columns and their meanings.
- The guidance SHALL suggest FHIR-relevant operations (e.g., "filter by gender", "group by encounter type").

#### Scenario: Chat guidance for Patient dataset
- **WHEN** Patient resources are extracted from a FHIR bundle
- **THEN** `ProcessingResult.chat_guidance` SHALL mention "FHIR Patient" and describe key columns
