# Non-Functional Requirements

Requirements are organized by the product vision stages (Upload → Model → Access → Visualize) plus cross-cutting concerns.

**Format guide:**
- **Planguage** for measurable targets — defines Scale (unit), Meter (how to test), Must (minimum), Plan (target), Wish (stretch)
- **Quality Attribute Scenarios** for behavioral requirements — defines Source, Stimulus, Environment, Response, Response Measure
- **Constraints** for binary (yes/no) architectural rules

---

## Stage 1: Upload

### NFR-U1: Upload Size Limit

- **Scale:** Maximum file size accepted by `POST /api/uploads` (megabytes)
- **Meter:** Automated test submitting files at boundary sizes
- **Past:** Unlimited (no enforcement except FHIR plugin at 100MB)
- **Must:** ≤ 200MB
- **Plan:** ≤ 100MB, consistent with FHIR plugin's `MAX_FILE_SIZE`
- **Wish:** Configurable per org via settings
- **Status:** Not enforced. Tracked in `s3-lifecycle-cleanup`.

### NFR-U2: Upload-to-Preview Latency

- **Scale:** Seconds from upload completion to preview table render in browser
- **Meter:** Playwright E2E test timing from file selection to visible table rows
- **Past:** Not measured
- **Must:** < 5s for a 10MB CSV
- **Plan:** < 3s for a 10MB CSV
- **Wish:** < 1s (streaming preview before full ingestion completes)
- **Status:** Implemented. Not measured in CI.

### NFR-U3: Ambiguous Format Handling

> **Source:** User  
> **Stimulus:** Uploads a multi-sheet Excel file  
> **Environment:** Normal operation  
> **Response:** System pauses processing, returns `202 Accepted` with available sheets and sample rows, waits for user to select sheet(s) before continuing  
> **Response Measure:** Zero data loss from unconfirmed sheet selection; user sees choices within the upload response  
> **Status:** Implemented.

### NFR-U4: Format Extensibility

> **Constraint:** Adding a new file format (e.g., Avro, ORC) SHALL require only a new plugin module implementing the `FormatPlugin` interface. No modifications to the upload router, ingestion pipeline, or existing plugins.  
> **Status:** Implemented. Plugin registry in `backend/app/plugins/`.

### NFR-U5: Upload State Observability

> **Constraint:** Every upload SHALL transition through an explicit state machine (`pending` → `processing` → `completed`/`failed`, with optional `awaiting_input`). State transitions SHALL be queryable via the API.  
> **Status:** Implemented.

---

## Stage 2: Model with Natural Language

### NFR-M1: Chat First-Token Latency

- **Scale:** Milliseconds from `POST /chat` to first SSE byte received by frontend
- **Meter:** P95 latency measured at the frontend `EventSource` `onmessage` callback over 100 requests with a single-sentence user message
- **Past:** Not measured
- **Must:** < 3000ms
- **Plan:** < 2000ms
- **Wish:** < 800ms
- **Status:** Implemented (Groq inference). Not measured.

### NFR-M2: Transform Preview Latency

- **Scale:** Milliseconds from `POST .../transforms/preview` to response
- **Meter:** P95 server-side response time for a preview on a 100K-row dataset with one cleaning operation
- **Past:** Not measured
- **Must:** < 5000ms
- **Plan:** < 2000ms
- **Wish:** < 500ms
- **Status:** Implemented. Not measured.

### NFR-M3: Transform Reversibility

> **Constraint:** All transforms (clean, filter, alias, map) SHALL be non-destructive. Raw Parquet files SHALL never be modified. Every transform SHALL support `enabled` → `disabled` (reversible) and `disabled` → `enabled` (re-enable) transitions.  
> **Status:** Implemented.

### NFR-M4: LLM Provider Failure

> **Source:** Groq API  
> **Stimulus:** API returns 5xx error, times out, or rate limits the request  
> **Environment:** Normal operation, user waiting for chat response  
> **Response:** Agent service returns a structured error event via SSE within the timeout window. Frontend displays a human-readable error message ("AI service temporarily unavailable — try again in a moment"). No silent hang, no broken stream state.  
> **Response Measure:** Error delivered to user within 5 seconds of failure detection. Frontend chat input re-enabled for retry.  
> **Status:** Not implemented. Agent has no timeout or error-to-SSE mapping for Groq failures.

### NFR-M5: Tool Call Schema Validation

> **Source:** LLM (Groq)  
> **Stimulus:** LLM generates a tool call with a column name that doesn't exist in the dataset schema, or an operator incompatible with the column type  
> **Environment:** Active dataset context with known schema  
> **Response:** Frontend rejects the tool call before execution and displays an error in chat. No table state mutation occurs.  
> **Response Measure:** Zero invalid tool calls reach TanStack Table state.  
> **Status:** Partially implemented. Zod enums constrain column names at the LLM level. No server-side or frontend re-validation.

### NFR-M6: Report Context Routing

> **Constraint:** The agent SHALL support `contextType: "report"` alongside `"dataset"` and `"view"`, with a dedicated tool set and system prompt for report modeling. All three context types required to complete the modeling stage.  
> **Status:** Not implemented. Tracked in `report-chat-tools`.

---

## Stage 3: Access (dbt Export + SQL)

### NFR-A1: SQL Query Start Latency

- **Scale:** Seconds from SQL query submission to first row returned via PostgreSQL wire protocol
- **Meter:** `psql` query against a pg_duckdb foreign table backed by Parquet in MinIO, timed with `\timing`
- **Past:** Not measured
- **Must:** < 10s for datasets under 1M rows
- **Plan:** < 5s for datasets under 1M rows
- **Wish:** < 2s (warm cache)
- **Status:** Implemented. Not measured.

### NFR-A2: Wire Protocol Compatibility

> **Constraint:** External SQL access SHALL use the standard PostgreSQL wire protocol. Any tool that speaks PostgreSQL (psql, DBeaver, Tableau, Power BI, Excel ODBC, Python psycopg2) SHALL connect without custom drivers or plugins.  
> **Status:** Implemented via pg_duckdb.

### NFR-A3: dbt Export Validity

> **Source:** User  
> **Stimulus:** Clicks "Export dbt project" on a project with 3 datasets, 2 views, and 1 report  
> **Environment:** Normal operation  
> **Response:** System generates a ZIP archive containing a complete dbt project with `dbt_project.yml`, source definitions, staging models (`stg_` prefix), intermediate models (`int_` prefix from views), and mart models (`fct_`/`dim_` prefix from reports). The archive is a valid dbt project that runs successfully with `dbt run` against the query engine.  
> **Response Measure:** `dbt parse` succeeds with zero errors. `dbt run` materializes all models.  
> **Status:** Implemented. No automated validation — no test runs `dbt parse` against the generated output.

### NFR-A4: Query Engine Auto-Sync Latency

- **Scale:** Seconds from dataset/transform change to query engine foreign table reflecting the change
- **Meter:** Measure time between outbox event commit and sync processor completion via structured log timestamps
- **Past:** Not measured
- **Must:** < 60s
- **Plan:** < 30s
- **Wish:** < 5s (near-real-time)
- **Status:** Implemented (event-driven via outbox). Not measured.

### NFR-A5: Credential Security

> **Constraint:** SQL access passwords SHALL be stored as hashed values (never plaintext). Credential regeneration SHALL enforce a 60-second cooldown to rate-limit brute-force rotation.  
> **Status:** Implemented.

### NFR-A6: Query Engine Resource Isolation

- **Scale:** Maximum RAM and CPU per query engine node
- **Meter:** Docker Compose `deploy.resources.limits` configuration
- **Past:** N/A
- **Must:** ≤ 4GB RAM, ≤ 4 CPU
- **Plan:** 2GB RAM, 2 CPU
- **Wish:** Auto-scaling based on query load
- **Status:** Implemented (2GB/2CPU in docker-compose.yml).

### NFR-A7: Storage Cleanup on Deletion

> **Source:** User  
> **Stimulus:** Deletes a project or individual dataset  
> **Environment:** Normal operation  
> **Response:** System deletes all associated Parquet files from S3/MinIO in addition to cascade-deleting database records. Query engine foreign tables are dropped via outbox event.  
> **Response Measure:** Zero orphaned Parquet files remain in the `datasets/{project_id}/` prefix after deletion. S3 `ListObjects` on the prefix returns empty.  
> **Status:** Not implemented. DB cascade works; S3 cleanup does not. Tracked in `s3-lifecycle-cleanup`.

---

## Stage 4: Visualize (Planned)

### NFR-V1: Dashboard Generation Latency

- **Scale:** Seconds from plan request to complete dashboard JSON
- **Meter:** CLI `planner plan` command wall-clock time, end-to-end including all agent stages
- **Past:** Not measured
- **Must:** < 120s
- **Plan:** < 60s
- **Wish:** < 30s with caching of section templates
- **Status:** Not measured. Planner is standalone.

### NFR-V2: Manifest Auto-Generation

> **Source:** Backend  
> **Stimulus:** User requests a dashboard plan for a project with Views and Reports  
> **Environment:** Views have typed columns; Reports have dimension/measure metadata  
> **Response:** System auto-generates a `SemanticManifest` JSON from project Views (→ data sources) and Reports (→ metrics/dimensions) without manual manifest authoring  
> **Response Measure:** Generated manifest passes schema validation and contains all View columns and Report measures  
> **Status:** Not implemented. Tracked in `planner-docker-integration`.

### NFR-V3: Planner Cost Isolation

- **Scale:** Maximum Anthropic API spend per plan request (USD)
- **Meter:** Token usage reported by Anthropic SDK per pipeline run
- **Past:** Not tracked
- **Must:** < $5 per plan (multi-agent pipeline with retries)
- **Plan:** < $2 per plan
- **Wish:** < $0.50 with prompt caching and smaller models for validation
- **Status:** Partially implemented. Env var config exists. No per-request budget enforcement.

---

## Security

### NFR-SEC1: Authentication Boundary

> **Constraint:** All API endpoints SHALL require authentication except: health checks (`/health`), OpenAPI docs (`/docs`, `/openapi.json`), JWKS (`/.well-known/jwks.json`), and auth flow (`/api/auth/*`). Enforced by `AuthMiddleware` on every request.  
> **Status:** Implemented.

### NFR-SEC2: Token Verification

> **Constraint:** Production auth SHALL validate JWT tokens via JWKS (asymmetric key verification through WorkOS). No shared secrets. Dev mode SHALL use a local RSA key pair served via `/.well-known/jwks.json`.  
> **Status:** Implemented.

### NFR-SEC3: Proxy Trust Boundary

> **Constraint:** Backend SHALL only trust `X-User-Id`, `X-Org-Id`, `X-User-Email` headers when `TRUST_PROXY_HEADERS=true` is explicitly set. Default is to verify Bearer tokens directly.  
> **Status:** Implemented.

### NFR-SEC4: CORS

> **Constraint:** CORS SHALL be restricted to origins listed in `CORS_ORIGINS`. No wildcard `*` in production.  
> **Status:** Implemented.

### NFR-SEC5: Org Gating

> **Constraint:** Authenticated users without an `org_id` SHALL be blocked from all endpoints except `/api/orgs` and `/api/orgs/me`. Organization membership is required before data access.  
> **Status:** Implemented.

### NFR-SEC6: Data at Rest Encryption

> **Source:** Infrastructure operator  
> **Stimulus:** Configures production S3 bucket  
> **Environment:** Production deployment  
> **Response:** All Parquet files stored with server-side encryption (SSE-S3 at minimum, SSE-KMS for healthcare deployments)  
> **Response Measure:** S3 bucket policy rejects unencrypted `PutObject` requests  
> **Status:** Not configured. MinIO dev setup has no encryption. Production S3 bucket policy TBD.

### NFR-SEC7: Transport Encryption

> **Constraint:** All service-to-service communication in production SHALL use TLS. Docker Compose internal networking is acceptable for development only.  
> **Status:** Not configured. Development uses unencrypted Docker network.

---

## Multi-Tenancy

### NFR-MT1: Query Scoping

> **Constraint:** All data queries SHALL be scoped by `org_id` via `RestrictedSession`. No query path SHALL exist that bypasses org scoping except admin/migration operations.  
> **Status:** Implemented.

### NFR-MT2: SQL Access Isolation

> **Constraint:** Query engine schemas SHALL be isolated per project. A project's SQL credentials SHALL only grant access to that project's schema. Cross-project queries SHALL be impossible.  
> **Status:** Implemented.

### NFR-MT3: API Rate Limiting

> **Source:** Tenant (org)  
> **Stimulus:** One org submits 100 chat requests per minute or 50 file uploads per minute  
> **Environment:** Multi-tenant production, shared infrastructure  
> **Response:** System throttles requests from the offending org with `429 Too Many Requests`. Other orgs are unaffected.  
> **Response Measure:** No single org can consume more than its fair share of chat agent or upload processing capacity. Other tenants maintain NFR-M1 and NFR-U2 latency targets.  
> **Status:** Not implemented. Only credential regeneration has a rate limit (60s cooldown).

---

## Reliability

### NFR-R1: Event Delivery

> **Constraint:** Side effects (query engine sync, project memory provisioning) SHALL use the outbox pattern. Events SHALL be committed in the same transaction as the business operation. The dispatcher SHALL guarantee at-least-once delivery with exponential backoff on failure.  
> **Status:** Implemented.

### NFR-R2: Health Probes

> **Constraint:** Every service SHALL expose a `GET /health` endpoint returning 200 on success. Docker Compose and Kubernetes health probes SHALL use these endpoints.  
> **Status:** Implemented.

### NFR-R3: Graceful Shutdown

> **Source:** Orchestrator (Docker, Kubernetes)  
> **Stimulus:** Sends `SIGTERM` to agent service during an active SSE stream  
> **Environment:** Rolling deployment  
> **Response:** Agent completes in-flight SSE responses (or closes them cleanly) before shutting down. No client receives a truncated stream without a proper close event.  
> **Response Measure:** Zero dropped SSE connections during deployments when using rolling updates with health check readiness gates.  
> **Status:** Implemented in agent (`SIGTERM`/`SIGINT` handlers).

### NFR-R4: Migration Safety

> **Constraint:** Database migrations SHALL be forward-compatible. No destructive `ALTER` (drop column, rename column, change type in place). New columns SHALL be nullable or have defaults. This supports zero-downtime deployments where old code runs against new schema.  
> **Status:** Implemented.

---

## Observability

### NFR-O1: Auth Audit Trail

> **Constraint:** Auth failures SHALL be logged with structured fields: request path, failure reason, client IP. Token values SHALL NOT appear in logs.  
> **Status:** Implemented.

### NFR-O2: Service Health Dashboard

> **Constraint:** Health endpoints SHALL return structured JSON including service name, version, and dependency status (DB connectivity, S3 reachability, query engine health).  
> **Status:** Partially implemented. Health endpoints exist but return minimal payloads.

### NFR-O3: Pipeline Operation Logging

> **Source:** System  
> **Stimulus:** User uploads a file, applies a transform, or previews a cleaning operation  
> **Environment:** Normal operation  
> **Response:** System emits a structured log event with: operation type, dataset ID, duration (ms), success/failure, and error detail on failure  
> **Response Measure:** Every upload and transform operation produces exactly one log event with duration. Log events are queryable for P95 latency dashboards.  
> **Status:** Partially implemented. Upload state machine exists. No duration logging on transforms.

### NFR-O4: Chat Tool Call Logging

> **Source:** Agent service  
> **Stimulus:** LLM generates a tool call (filterTable, trimWhitespace, createView, etc.)  
> **Environment:** Active chat session  
> **Response:** Agent logs: tool name, dataset/view/report ID, execution duration (ms), success/failure  
> **Response Measure:** Every tool call produces one log event. Enables "most used tools" and "tool failure rate" dashboards.  
> **Status:** Not implemented.

---

## Compatibility

### NFR-C1: Zero-Dependency Dev Mode

> **Constraint:** `docker compose up` with default profile SHALL start all required services with no external dependencies. SQLite for metadata, MinIO for storage, dev auth mode with hardcoded tokens. No PostgreSQL, no WorkOS, no Groq API key required for basic UI exploration.  
> **Status:** Implemented. (Groq API key IS required for chat functionality.)

### NFR-C2: Storage Abstraction

> **Constraint:** All S3 operations SHALL use the boto3/aioboto3 API. MinIO in development, AWS S3 in production. No code paths SHALL reference MinIO-specific APIs.  
> **Status:** Implemented.

### NFR-C3: Auth Mode Switching

> **Constraint:** `AUTH_MODE` environment variable SHALL switch between `"dev"` (hardcoded user, local JWKS) and `"workos"` (JWT via WorkOS JWKS). No code changes required.  
> **Status:** Implemented.

### NFR-C4: Single-Command Startup

> **Constraint:** `docker compose up` SHALL start all default-profile services and produce a working application at `http://localhost:5173`.  
> **Status:** Implemented.

---

## Build & Deployment

### NFR-B1: Reproducible Images

> **Constraint:** Default-profile Docker images SHALL be built by Bazel for deterministic, hermetic builds. The optional `api-full` service MAY use a traditional Dockerfile for hot-reload development.  
> **Status:** Implemented.

### NFR-B2: CI Unit Tests

> **Constraint:** CI SHALL run the full unit test suite (Vitest for frontend/agent/auth-proxy, pytest for backend) on every pull request. Merge SHALL be blocked on test failure.  
> **Status:** Implemented.

### NFR-B3: CI E2E Tests

> **Source:** CI pipeline  
> **Stimulus:** Pull request opened or updated  
> **Environment:** GitHub Actions with Docker Compose  
> **Response:** CI spins up all services, runs Playwright smoke + critical-path tests (upload flow, basic chat, auth lifecycle), uploads HTML report as artifact  
> **Response Measure:** E2E job completes within 10 minutes. Failures produce Playwright traces for debugging.  
> **Status:** Not wired. E2E tests exist locally. Tracked in `e2e-ci-pipeline`.

### NFR-B4: Static Frontend

> **Constraint:** Frontend builds SHALL produce static assets (HTML/JS/CSS) servable by any CDN or web server (Nginx, Cloudflare Pages, S3+CloudFront). No server-side rendering dependency.  
> **Status:** Implemented.
