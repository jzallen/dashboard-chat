# redis-session-store Specification

## Purpose
Documents the removal of Redis-backed session storage, replaced by Stream.io channel persistence.

## Requirements
### Requirement: Redis Session Storage [REMOVED]

The Redis-backed session storage is removed. All functionality is replaced by Stream.io channel persistence.

- DELETE `worker/lib/sessions/redis-store.ts` (119 lines)
- DELETE Redis key structures: `session:{id}:meta`, `session:{id}:turns`, `sessions:active`, `dataset:{id}:sessions`
- DELETE `REDIS_URL` environment variable from Worker configuration
- DELETE Redis container from `docker-compose.yml`
- DELETE `redis_data` volume from `docker-compose.yml`
- DELETE Redis health check dependency from Worker service in `docker-compose.yml`

**Rationale**: Stream.io provides equivalent persistence (messages in channels) with managed infrastructure. Redis added operational complexity (TTL management, data loss risk on restart) for functionality that is better served by a purpose-built chat platform.
