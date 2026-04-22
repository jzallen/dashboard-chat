# s3-session-archive Specification

## Purpose
Documents the removal of S3-based JSONL session archival, replaced by Stream.io channel persistence with built-in retention and query capabilities.

## Requirements
### Requirement: S3 JSONL Session Archival [REMOVED]

The S3-based session archival SHALL be removed. All functionality SHALL be replaced by Stream.io channel persistence.

- `worker/lib/sessions/s3-store.ts` SHALL be deleted.
- The S3 session log path structure `{projectId}/{datasetId}/{sessionId}.jsonl` SHALL no longer be written.
- The `SessionStartEvent` and `TurnEvent` JSONL event types SHALL be removed.
- The `S3_BUCKET_LOGS` environment variable SHALL be removed from Worker configuration.
- The Worker SHALL no longer depend on S3 for audit logging (S3 remains for Parquet data storage via the Backend).

**Rationale**: Stream.io provides indefinite message retention with search and export capabilities via REST API. The JSONL format was append-only with no query capability — Stream channels are queryable by timestamp, user, and custom fields.

#### Scenario: Worker runs without S3 audit logging

- **GIVEN** a Worker deployment with no `S3_BUCKET_LOGS` configured
- **WHEN** the Worker handles chat requests and completes turns
- **THEN** no JSONL event SHALL be written to S3
- **AND** session history SHALL be available via Stream.io channel queries instead

#### Scenario: Repository contains no S3 session archival code

- **WHEN** the repository is inspected after removal
- **THEN** `worker/lib/sessions/s3-store.ts` SHALL NOT exist
- **AND** no code SHALL reference `SessionStartEvent`, `TurnEvent`, or `S3_BUCKET_LOGS`
