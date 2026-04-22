## Purpose

Describes the `Hl7v2Plugin` implementation for `.hl7` message files. It validates HL7v2 structure (MSH segment required), flattens segment fields into a tabular schema, and supports files containing batches of messages so legacy clinical data becomes queryable.

## Requirements

### Requirement: Hl7v2Plugin Implementation

The system SHALL provide an `Hl7v2Plugin` class in `backend/app/plugins/hl7v2_plugin.py` that implements the `FileFormatPlugin` protocol for HL7v2 message files.

- `name` SHALL be `"hl7v2"`.
- `extensions` SHALL be `[".hl7"]`.
- `detect_choices()` SHALL always return `None` (HL7v2 files do not require user choices).
- `validate()` SHALL reject files that do not contain valid HL7v2 message structure (missing MSH segment).
- `process()` SHALL parse HL7v2 messages and flatten segments into a tabular DataFrame.

#### Scenario: Valid HL7v2 file with single message
- **WHEN** an `.hl7` file containing one ADT^A01 message is uploaded
- **THEN** `process()` SHALL return a `ProcessingResult` with a DataFrame containing 1 row
- **THEN** columns SHALL be derived from segment fields (e.g., `msh_message_type`, `pid_patient_id`)

#### Scenario: Valid HL7v2 file with multiple messages
- **WHEN** an `.hl7` file containing 100 HL7v2 messages is uploaded
- **THEN** `process()` SHALL return a DataFrame with 100 rows (one per message)
- **THEN** all messages SHALL share the same column structure

#### Scenario: Invalid HL7v2 file is rejected
- **WHEN** a file with `.hl7` extension that does not begin with `MSH|` is uploaded
- **THEN** `validate()` SHALL raise `PluginValidationError` with message "Invalid HL7v2 file: no MSH segment found"

---

### Requirement: HL7v2 Segment Flattening

The plugin SHALL flatten HL7v2 segments into columns using a `{segment}_{field_name}` naming convention for common segments.

- MSH (Message Header) segment fields SHALL be extracted: `msh_message_type`, `msh_sending_facility`, `msh_message_datetime`.
- PID (Patient Identification) segment fields SHALL be extracted: `pid_patient_id`, `pid_patient_name`, `pid_date_of_birth`, `pid_sex`, `pid_address`.
- PV1 (Patient Visit) segment fields SHALL be extracted: `pv1_patient_class`, `pv1_attending_doctor`, `pv1_admit_datetime`.
- If a segment is absent from a message, its columns SHALL be `None` in that row.
- Repeating fields SHALL use the first repetition.

#### Scenario: ADT message with PID and PV1 segments
- **WHEN** an HL7v2 ADT^A01 message contains MSH, PID, and PV1 segments
- **THEN** the DataFrame row SHALL include columns for all three segments
- **THEN** `pid_patient_name` SHALL contain the patient's name from PID-5

#### Scenario: Message missing PV1 segment
- **WHEN** an HL7v2 message contains MSH and PID but no PV1 segment
- **THEN** PV1 columns (`pv1_patient_class`, etc.) SHALL be `None` for that row
- **THEN** MSH and PID columns SHALL be populated normally

---

### Requirement: HL7v2 Plugin Provides Chat Guidance

The plugin SHALL return `chat_guidance` in its `ProcessingResult` to help the AI assistant understand HL7v2 data context.

- The guidance SHALL explain the column naming convention (`{segment}_{field_name}`).
- The guidance SHALL list the extracted segments and their meanings.
- The guidance SHALL suggest common operations (e.g., "filter by message type", "group by patient class").

#### Scenario: Chat guidance is set after HL7v2 processing
- **WHEN** an HL7v2 file is processed successfully
- **THEN** `ProcessingResult.chat_guidance` SHALL be a non-empty string
- **THEN** the guidance SHALL mention HL7v2 and the column naming convention

---

### Requirement: HL7v2 dbt Macros

The plugin SHALL optionally define class-level `dbt_macros` for HL7v2-specific SQL helpers included in dbt exports.

- The plugin MAY provide a `parse_hl7_segment` macro for runtime HL7 parsing in DuckDB.

#### Scenario: dbt export includes HL7v2 macros
- **WHEN** a project with HL7v2-sourced datasets is exported as a dbt project
- **THEN** the `macros/` directory SHALL include any HL7v2-specific macros defined by the plugin
