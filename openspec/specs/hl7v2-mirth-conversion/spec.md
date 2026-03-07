# HL7v2 Mirth Connect Conversion

## Purpose

Defines the 3-phase HL7v2 upload pipeline: validate MSH segments, convert to FHIR via Mirth Connect, and normalize through the FHIR plugin. Includes Mirth Connect integration, configuration, and dual artifact persistence.

## Requirements

### Requirement: 3-phase HL7v2 upload pipeline

The HL7v2 plugin SHALL implement a 3-phase upload process: receive raw HL7v2, convert to FHIR via Mirth Connect, then normalize via the FHIR plugin pipeline.

#### Scenario: Successful 3-phase processing
- **WHEN** a valid HL7v2 file is uploaded
- **THEN** Phase 1 SHALL store the raw HL7v2 content in S3 under the upload's `raw_storage_path`
- **THEN** Phase 2 SHALL send the HL7v2 content to Mirth Connect and receive a FHIR R4 Bundle
- **THEN** Phase 2 SHALL store the converted FHIR bundle in S3 under the upload's `converted_storage_path`
- **THEN** Phase 3 SHALL pass the FHIR bundle through the FHIR plugin's normalization pipeline
- **THEN** the final output SHALL be a `MultiProcessingResult` with one dataset per FHIR resource type

#### Scenario: HL7v2 file with multiple messages
- **WHEN** a file contains multiple HL7v2 messages separated by standard delimiters
- **THEN** all messages SHALL be sent to Mirth Connect as a batch
- **THEN** the resulting FHIR bundle SHALL contain resources from all messages

---

### Requirement: Mirth Connect HTTP integration

The HL7v2 plugin SHALL call Mirth Connect's HTTP API to convert HL7v2 messages to FHIR R4 bundles. The connection SHALL be configured via environment variables.

#### Scenario: Mirth Connect converts successfully
- **WHEN** the plugin sends valid HL7v2 content to the Mirth Connect endpoint
- **THEN** Mirth Connect SHALL return a FHIR R4 Bundle as JSON
- **THEN** the plugin SHALL validate the returned Bundle before proceeding to Phase 3

#### Scenario: Mirth Connect is unreachable
- **WHEN** the Mirth Connect URL is configured but the service is not responding
- **THEN** the plugin SHALL raise `PluginValidationError` with message "HL7v2 conversion service is unavailable"
- **THEN** the raw HL7v2 file SHALL still be persisted in S3

#### Scenario: Mirth Connect returns an error
- **WHEN** Mirth Connect returns a non-200 response or invalid FHIR output
- **THEN** the plugin SHALL raise `PluginValidationError` with the error details
- **THEN** the raw HL7v2 file SHALL still be persisted in S3

#### Scenario: Mirth Connect times out
- **WHEN** the Mirth Connect API call exceeds the configured timeout (default 60 seconds)
- **THEN** the plugin SHALL raise `PluginValidationError` with a timeout message

---

### Requirement: Mirth Connect configuration

The system SHALL configure Mirth Connect connection via environment variables, with optional defaults for development.

#### Scenario: Production configuration
- **WHEN** `MIRTH_CONNECT_URL` and `MIRTH_CONNECT_API_KEY` environment variables are set
- **THEN** the plugin SHALL use these values for HTTP calls to Mirth Connect

#### Scenario: Missing configuration
- **WHEN** `MIRTH_CONNECT_URL` is not set and an HL7v2 file is uploaded
- **THEN** the plugin SHALL raise `PluginValidationError` with message "HL7v2 conversion is not configured. Set MIRTH_CONNECT_URL."

#### Scenario: Dev environment with Mirth Connect in Docker
- **WHEN** the `healthcare` Docker Compose profile is active
- **THEN** Mirth Connect SHALL be available at the configured URL
- **THEN** the HL7v2 plugin SHALL function end-to-end

---

### Requirement: Dual artifact persistence

Both the raw HL7v2 file and the converted FHIR bundle SHALL be stored under the same upload record in S3.

#### Scenario: Both artifacts are stored
- **WHEN** an HL7v2 file is successfully converted to FHIR
- **THEN** the upload record SHALL have `raw_storage_path` pointing to the original HL7v2 file
- **THEN** the upload record SHALL have `converted_storage_path` pointing to the FHIR bundle JSON

#### Scenario: Raw artifact persists on conversion failure
- **WHEN** Mirth Connect fails to convert the HL7v2 file
- **THEN** `raw_storage_path` SHALL still contain the original HL7v2 file
- **THEN** `converted_storage_path` SHALL be `None`

---

### Requirement: HL7v2 validation

The HL7v2 plugin SHALL validate that uploaded files contain valid HL7v2 messages before sending to Mirth Connect.

#### Scenario: Valid HL7v2 file accepted
- **WHEN** a file contains one or more HL7v2 messages with MSH segments
- **THEN** validation SHALL pass

#### Scenario: Invalid file rejected
- **WHEN** a file does not contain any MSH segments
- **THEN** the plugin SHALL raise `PluginValidationError` with message "File does not contain valid HL7v2 messages"
