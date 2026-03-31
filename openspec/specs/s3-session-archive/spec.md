# s3-session-archive Specification

## Purpose
Documents the removal of S3-based JSONL session archival, replaced by Stream.io channel persistence with built-in retention and query capabilities.

## Requirements
### Requirement: S3 JSONL Session Archival [REMOVED]

The S3-based session archival is removed. All functionality is replaced by Stream.io channel persistence.

- DELETE `worker/lib/sessions/s3-store.ts` (104 lines)
- DELETE S3 session log path structure: `{projectId}/{datasetId}/{sessionId}.jsonl`
- DELETE `SessionStartEvent` and `TurnEvent` JSONL event types
- DELETE `S3_BUCKET_LOGS` environment variable from Worker configuration
- The Worker's S3 dependency for audit logging is removed (S3 remains for Parquet data storage via the Backend)

**Rationale**: Stream.io provides indefinite message retention with search and export capabilities via REST API. The JSONL format was append-only with no query capability — Stream channels are queryable by timestamp, user, and custom fields.
