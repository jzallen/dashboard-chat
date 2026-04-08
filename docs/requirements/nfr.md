# Non-Functional Requirements

Requirements are organized by the product vision stages (Upload → Model → Access → Visualize) plus cross-cutting concerns. Each requirement is tagged with implementation status.

## Stage 1: Upload

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-U1 | File uploads enforce a 100MB size limit | Covers common CSV/Excel files; larger datasets should use direct S3 upload | **Not enforced** |
| NFR-U2 | Dataset preview renders within 3 seconds of upload completion | Upload flow should feel immediate; preview is the confirmation step | Implemented |
| NFR-U3 | Multi-sheet files prompt for user confirmation before processing | No silent data loss from ambiguous file formats | Implemented |
| NFR-U4 | File format support extensible via plugin registry without modifying core upload logic | Adding new formats (Avro, ORC) should be additive, not invasive | Implemented |
| NFR-U5 | Upload status tracked through an explicit state machine (pending → processing → completed/failed) | Makes debugging upload failures deterministic | Implemented |

## Stage 2: Model with Natural Language

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-M1 | Chat SSE first token arrives within 2 seconds of request submission | Users perceive >2s as unresponsive in a conversational UI | Implemented |
| NFR-M2 | Transform preview returns within 2 seconds | Users iterate on cleaning operations interactively — latency kills the feedback loop | Implemented |
| NFR-M3 | All transforms are non-destructive and reversible (enable/disable/delete) | Raw Parquet is never modified; users can undo any operation | Implemented |
| NFR-M4 | LLM provider failure returns a clear error to the user within 5 seconds; no silent hangs | Chat is the only interaction model — a stuck chat is a dead product | **Not implemented** (no timeout/fallback) |
| NFR-M5 | Tool call results are validated against the dataset schema before execution | Prevents the LLM from referencing non-existent columns or applying invalid operations | Partially (Zod enums constrain columns, but no server-side re-validation) |
| NFR-M6 | Report context routing available in agent alongside dataset and view contexts | Completing the modeling layer requires all three context types | **Not implemented** (tracked in `report-chat-tools`) |

## Stage 3: Access (dbt Export + SQL)

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-A1 | SQL access queries start returning rows within 5 seconds for datasets under 1M rows | External BI tools expect sub-10s query starts | Implemented |
| NFR-A2 | External SQL access uses standard PostgreSQL wire protocol | Any SQL client, BI tool, or ODBC driver can connect without custom drivers | Implemented |
| NFR-A3 | dbt export produces a valid, runnable dbt project (sources → staging → intermediate → marts) | The export is the deliverable — it must work out of the box with `dbt run` | Implemented (but no automated validation) |
| NFR-A4 | Query engine views auto-sync within 30 seconds of dataset or transform changes | Users shouldn't need to click "Sync" for routine operations — the outbox pattern handles this | Implemented (event-driven sync) |
| NFR-A5 | SQL access credentials stored as hashed passwords; regenerable with 60-second cooldown | Compromise of metadata DB doesn't expose plaintext credentials | Implemented |
| NFR-A6 | Query engine resources limited to 2GB RAM / 2 CPU per node | Prevents single-tenant resource exhaustion in shared infrastructure | Implemented |
| NFR-A7 | S3 storage cleaned up when datasets or projects are deleted | Orphaned Parquet files waste storage and create compliance risk | **Not implemented** (tracked in `s3-lifecycle-cleanup`) |

## Stage 4: Visualize (Planned)

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-V1 | Dashboard plan generation completes within 60 seconds | Multi-agent pipeline is batch, not interactive — users accept a wait if they get a complete dashboard | **Not measured** (planner is standalone) |
| NFR-V2 | Semantic manifest auto-generated from project Views and Reports | Users should not manually assemble manifests — the platform derives them from the modeling layer | **Not implemented** (tracked in `planner-docker-integration`) |
| NFR-V3 | Planner service isolated with its own API key and resource limits | Prevents Claude API costs from being unbounded; separate from chat agent billing | Partially (env var config exists, no resource limits) |

## Security

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-SEC1 | All API endpoints require authentication except health checks and auth flow | Defense in depth; auth middleware checks every request | Implemented |
| NFR-SEC2 | JWT tokens validated via JWKS in production (WorkOS) | Standard asymmetric key verification; no shared secrets | Implemented |
| NFR-SEC3 | Auth proxy injects identity headers; backend trusts proxy only when TRUST_PROXY_HEADERS is set | Clear trust boundary between proxy and API | Implemented |
| NFR-SEC4 | CORS restricted to configured origins | Prevents cross-origin request forgery from unauthorized domains | Implemented |
| NFR-SEC5 | Org-less authenticated users blocked from all endpoints except /api/orgs | Users must belong to an organization before accessing any data | Implemented |
| NFR-SEC6 | Data at rest in S3 encrypted via server-side encryption (SSE-S3 or SSE-KMS) | Protects Parquet files containing potentially sensitive data | **Not configured** |
| NFR-SEC7 | All service-to-service communication over TLS in production | Prevents credential/data interception between containers | **Not configured** (Docker network only) |

## Multi-Tenancy

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-MT1 | All data queries scoped by org_id via RestrictedSession | Prevents cross-tenant data leakage at the repository layer | Implemented |
| NFR-MT2 | Query engine schemas isolated per project within the org | External SQL access cannot see other projects' data | Implemented |
| NFR-MT3 | API rate limiting per org on upload and chat endpoints | Prevents a single tenant from exhausting shared resources | **Not implemented** |

## Reliability

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-R1 | Outbox pattern for event-driven side effects with at-least-once delivery | Events committed with business operations; no lost syncs | Implemented |
| NFR-R2 | Health check endpoints on all services | Enables Docker/Kubernetes health probes and load balancer checks | Implemented |
| NFR-R3 | Graceful shutdown on SIGTERM/SIGINT for agent service | Prevents dropped SSE connections during deployments | Implemented |
| NFR-R4 | Database migrations are forward-compatible (no destructive ALTER) | Supports zero-downtime deployments with rolling updates | Implemented |

## Observability

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-O1 | Structured logging on auth failures with request path | Enables security audit trails without leaking tokens | Implemented |
| NFR-O2 | Health endpoints return service status and dependencies | Enables monitoring dashboards to track service mesh health | Implemented |
| NFR-O3 | Upload and transform operations emit structured log events with duration and status | Debugging data pipeline issues requires tracing the full operation lifecycle | Partially (upload state machine exists, no duration logging) |
| NFR-O4 | Chat tool call execution logged with tool name, duration, and success/failure | Enables understanding which operations users perform and where failures occur | **Not implemented** |

## Compatibility

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-C1 | Dev mode works with SQLite (no PostgreSQL dependency) | Developers can run the full stack with `docker compose up` | Implemented |
| NFR-C2 | S3 API abstracted behind MinIO (dev) / AWS S3 (prod) | Same code paths in development and production | Implemented |
| NFR-C3 | Auth mode switchable between dev (hardcoded) and WorkOS (production) | Eliminates external auth dependency for local development | Implemented |
| NFR-C4 | All services startable with single `docker compose up` command | Reduces onboarding friction for new developers | Implemented |

## Build & Deployment

| ID | Requirement | Rationale | Status |
|----|-------------|-----------|--------|
| NFR-B1 | Docker images built by Bazel for reproducibility | Identical images regardless of build environment | Implemented |
| NFR-B2 | CI runs unit test suite (Vitest + pytest) on every PR | Catches regressions before merge | Implemented |
| NFR-B3 | E2E tests (Playwright) runnable in CI with Docker Compose services | Validates cross-service integration that unit tests cannot cover | **Not wired** (tracked in `e2e-ci-pipeline`) |
| NFR-B4 | Frontend builds produce static assets servable by any CDN/web server | Decouples frontend deployment from backend | Implemented |
