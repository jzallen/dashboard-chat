# Non-Functional Requirements

## Performance

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-P1 | Chat SSE first token must arrive within 2 seconds of request submission | Users perceive >2s as unresponsive in a conversational UI |
| NFR-P2 | Dataset preview must render within 3 seconds of upload completion | Upload flow should feel immediate; preview is the confirmation step |
| NFR-P3 | API list endpoints must respond within 500ms for pages of 50 items | Cursor-based pagination keeps response times constant regardless of total count |
| NFR-P4 | File uploads must support files up to 100MB | Covers common CSV/Excel files; larger datasets should use direct S3 upload |
| NFR-P5 | Transform preview must return within 2 seconds | Users iterate on cleaning operations interactively |
| NFR-P6 | SQL access queries must start returning rows within 5 seconds for datasets under 1M rows | External BI tools expect sub-10s query starts |

## Scalability

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-S1 | Multi-tenant isolation: all data queries must be scoped by org_id | Prevents cross-tenant data leakage; enforced by RestrictedSession |
| NFR-S2 | Cursor-based pagination on all list endpoints | Offset pagination degrades at scale; cursor-based is O(1) |
| NFR-S3 | Stateless API and agent services | Enables horizontal scaling; all state lives in DB, S3, or Stream.io |
| NFR-S4 | Query engine resources limited to 2GB RAM / 2 CPU per node | Prevents single-tenant resource exhaustion in shared infrastructure |

## Security

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-SEC1 | All API endpoints require authentication except health checks and auth flow | Defense in depth; auth middleware checks every request |
| NFR-SEC2 | JWT tokens validated via JWKS in production (WorkOS) | Standard asymmetric key verification; no shared secrets |
| NFR-SEC3 | SQL access credentials stored as hashed passwords | Compromise of DB doesn't expose plaintext passwords |
| NFR-SEC4 | Credential regeneration enforces 60-second cooldown | Rate limits brute-force credential rotation attacks |
| NFR-SEC5 | CORS restricted to configured origins | Prevents cross-origin request forgery from unauthorized domains |
| NFR-SEC6 | Auth proxy injects identity headers; backend trusts proxy only when TRUST_PROXY_HEADERS is set | Clear trust boundary between proxy and API |
| NFR-SEC7 | Org-less authenticated users blocked from all endpoints except /api/orgs | Users must belong to an organization before accessing any data |

## Reliability

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-R1 | Outbox pattern for event-driven side effects | Guarantees at-least-once delivery; events committed with business operations |
| NFR-R2 | Health check endpoints on all services | Enables Docker/Kubernetes health probes and load balancer checks |
| NFR-R3 | Graceful shutdown on SIGTERM/SIGINT for agent service | Prevents dropped SSE connections during deployments |
| NFR-R4 | Database migrations are forward-compatible (no destructive ALTER) | Supports zero-downtime deployments with rolling updates |
| NFR-R5 | Upload processing handles multi-sheet files with user confirmation | No silent data loss from ambiguous file formats |

## Observability

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-O1 | Structured logging on auth failures with request path | Enables security audit trails without leaking tokens |
| NFR-O2 | Health endpoints return service status and dependencies | Enables monitoring dashboards to track service mesh health |
| NFR-O3 | Upload status tracked through explicit state machine | Makes debugging upload failures deterministic |

## Compatibility

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-C1 | Dev mode works with SQLite (no PostgreSQL dependency) | Developers can run the full stack with `docker compose up` — no external DB setup |
| NFR-C2 | S3 API abstracted behind MinIO (dev) / AWS S3 (prod) | Same code paths in development and production |
| NFR-C3 | Auth mode switchable between dev (hardcoded) and WorkOS (production) | Eliminates external auth dependency for local development |
| NFR-C4 | External SQL access uses standard PostgreSQL wire protocol | Any SQL client, BI tool, or ORM can connect without custom drivers |
| NFR-C5 | File format support extensible via plugin registry | Adding new formats (e.g., Avro, ORC) doesn't require modifying core upload logic |

## Build & Deployment

| ID | Requirement | Rationale |
|----|-------------|-----------|
| NFR-B1 | Docker images built by Bazel for reproducibility | Identical images regardless of build environment |
| NFR-B2 | All services startable with single `docker compose up` command | Reduces onboarding friction for new developers |
| NFR-B3 | CI runs full test suite (Vitest + pytest + Playwright) on every PR | Catches regressions before merge |
| NFR-B4 | Frontend builds produce static assets servable by any CDN/web server | Decouples frontend deployment from backend |
