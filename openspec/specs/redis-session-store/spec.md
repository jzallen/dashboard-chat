# redis-session-store Specification

## Purpose
Documents the removal of Redis-backed session storage, replaced by Stream.io channel persistence.

## Requirements
### Requirement: Redis Session Storage [REMOVED]

The Redis-backed session storage SHALL be removed. All functionality SHALL be replaced by Stream.io channel persistence.

- `worker/lib/sessions/redis-store.ts` SHALL be deleted.
- Redis key structures `session:{id}:meta`, `session:{id}:turns`, `sessions:active`, and `dataset:{id}:sessions` SHALL no longer be read or written.
- The `REDIS_URL` environment variable SHALL be removed from Worker configuration.
- The Redis container, `redis_data` volume, and Redis health check dependency for the Worker service SHALL be removed from `docker-compose.yml`.

**Rationale**: Stream.io provides equivalent persistence (messages in channels) with managed infrastructure. Redis added operational complexity (TTL management, data loss risk on restart) for functionality that is better served by a purpose-built chat platform.

#### Scenario: Worker boots without Redis

- **GIVEN** a Worker deployment with no Redis container and no `REDIS_URL` configured
- **WHEN** the Worker starts and handles chat requests
- **THEN** the Worker SHALL start successfully and serve `/chat` without any Redis connection
- **AND** no code path SHALL attempt to read from or write to the removed Redis key structures

#### Scenario: Repository contains no Redis session code

- **WHEN** the repository is inspected after removal
- **THEN** `worker/lib/sessions/redis-store.ts` SHALL NOT exist
- **AND** `docker-compose.yml` SHALL NOT declare a Redis service, `redis_data` volume, or Redis-dependent health check for the Worker
