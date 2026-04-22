# session-flusher Specification

## Purpose
Documents the removal of the periodic session flusher, replaced by Stream.io's at-write-time persistence.

## Requirements
### Requirement: Session Flusher [REMOVED]

The periodic session flusher SHALL be removed. Stream.io handles persistence at write time — no batch flush SHALL be performed by the Worker.

- `worker/lib/sessions/flusher.ts` SHALL be deleted.
- The flusher start/stop lifecycle calls in `worker/index.ts` (`sessionManager.start()`, `sessionManager.stop()`) SHALL be removed.
- The 60-second flush interval and 5-minute idle threshold logic SHALL no longer exist.
- The re-entrancy guard (`isFlushing` flag) SHALL be removed.

**Rationale**: The flusher existed to move data from Redis (ephemeral, TTL-limited) to S3 (durable). With Stream.io, messages are durable at write time. There is no hot/cold tier to manage.

#### Scenario: Worker boots without flusher

- **GIVEN** a Worker process starting up
- **WHEN** the Worker initialises
- **THEN** no periodic flush interval SHALL be scheduled
- **AND** no re-entrancy guard SHALL be required because no background flush runs

#### Scenario: Repository contains no flusher code

- **WHEN** the repository is inspected after removal
- **THEN** `worker/lib/sessions/flusher.ts` SHALL NOT exist
- **AND** `worker/index.ts` SHALL NOT reference `sessionManager.start()` or `sessionManager.stop()`
