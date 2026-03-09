## REMOVED Requirements

### Requirement: Session Flusher

The periodic session flusher is removed. Stream.io handles persistence at write time — no batch flush needed.

- DELETE `worker/lib/sessions/flusher.ts` (83 lines)
- DELETE flusher start/stop lifecycle in `worker/index.ts` (`sessionManager.start()`, `sessionManager.stop()`)
- DELETE 60-second flush interval and 5-minute idle threshold logic
- DELETE re-entrancy guard (`isFlushing` flag)

**Rationale**: The flusher existed to move data from Redis (ephemeral, TTL-limited) to S3 (durable). With Stream.io, messages are durable at write time. There is no hot/cold tier to manage.
