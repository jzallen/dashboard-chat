# Non-Functional Requirements

Requirements organized by the prototyping workflow (Upload → Model → Preview → Handoff) plus cross-cutting concerns. Each uses the format best suited to its nature:

- **Planguage** (Scale/Meter/Must/Plan) for measurable targets
- **Quality Attribute Scenarios** for behavioral requirements
- **Declarative invariants** for binary constraints

Status tags: **Implemented**, **Partial**, **Not implemented**, **Not measured**

---

## Stage 1: Upload

### NFR-U1: Upload Size Limit

> **Scale:** Maximum file size accepted by POST /api/uploads
> **Meter:** Reject with HTTP 413 when file exceeds threshold
> **Must:** 200 MB
> **Plan:** 100 MB (tighter limit encourages Parquet pre-conversion for large files)
> **Status:** **Not implemented** — no size check in upload router. FHIR plugin enforces 100MB independently.

### NFR-U2: Time to Preview

> **Scale:** Wall-clock time from upload completion to rendered preview table
> **Meter:** P95 measured on CSV files under 50MB
> **Must:** < 5 seconds
> **Plan:** < 3 seconds
> **Status:** **Implemented** — Parquet conversion + preview row generation

### NFR-U3: Multi-Sheet Confirmation

> **Stimulus:** User uploads a multi-sheet Excel file
> **Response:** System pauses, presents sheet options, waits for user selection
> **Measure:** No data processed without explicit user confirmation
> **Status:** **Implemented** — `awaiting_input` state with choices list

### NFR-U4: Format Extensibility

> Adding a new file format (e.g., Avro, Synthea FHIR bundles) SHALL require only a new plugin module — no changes to core upload logic.
> **Status:** **Implemented** — plugin registry pattern

---

## Stage 2: Model with Natural Language

### NFR-M1: Chat Responsiveness

> **Scale:** Time from POST /chat to first SSE byte received by frontend
> **Meter:** P95 latency over 100 requests during normal operation
> **Must:** < 3 seconds
> **Plan:** < 2 seconds
> **Wish:** < 1 second
> **Status:** **Implemented** — Groq inference delivers sub-2s first token typically

### NFR-M2: Transform Preview Latency

> **Scale:** Time from transform preview request to rendered result
> **Meter:** P95 on datasets under 100K rows
> **Must:** < 5 seconds
> **Plan:** < 2 seconds
> **Status:** **Implemented** — pg_duckdb executes preview SQL

### NFR-M3: Non-Destructive Exploration

> All transforms SHALL be reversible. Raw Parquet files SHALL never be modified by any transform operation. Users SHALL be able to disable and re-enable any transform without data loss.
> **Status:** **Implemented** — transforms generate SQL via Ibis; Parquet is read-only

### NFR-M4: LLM Provider Failure Handling

> **Stimulus:** Groq API returns 500, times out, or is unreachable
> **Response:** User receives a clear error message in the chat within 5 seconds; no silent hang
> **Measure:** Error displayed within 5s; SSE connection closed cleanly
> **Status:** **Not implemented** — no timeout or fallback mechanism

### NFR-M5: Report Context Routing

> The agent SHALL support `contextType: "report"` alongside `"dataset"` and `"view"`, enabling the full modeling layer.
> **Status:** **Not implemented** — tracked in `report-chat-tools` proposal

---

## Stage 3: Preview (Planned)

### NFR-P1: Dashboard Generation Time

> **Scale:** Wall-clock time from natural language prompt to rendered dashboard in preview tab
> **Meter:** End-to-end including LangGraph pipeline + Vizro rendering
> **Must:** < 120 seconds
> **Plan:** < 60 seconds
> **Wish:** < 30 seconds
> **Status:** **Not measured** — planner is standalone CLI

### NFR-P2: Hot Reload Latency

> **Scale:** Time from natural language refinement to updated preview in the dashboard tab
> **Meter:** Wall-clock from chat submission to re-rendered preview
> **Must:** < 30 seconds (incremental changes should be faster than full generation)
> **Plan:** < 15 seconds
> **Status:** **Not implemented** — preview tab and hot-reload mechanism not yet built

### NFR-P3: Manifest Auto-Generation

> The system SHALL auto-generate a semantic manifest from project Views and Reports. Users SHALL NOT manually assemble manifests.
> **Status:** **Not implemented** — tracked in `planner-docker-integration` proposal

---

## Stage 4: Handoff

### NFR-H1: dbt Export Validity

> **Stimulus:** User exports a project with datasets, views, and reports
> **Response:** The exported zip contains a valid dbt project that passes `dbt parse` without errors
> **Measure:** All model files, schema YAML, macros, and profiles.yml present and syntactically correct
> **Status:** **Implemented** — 4-layer export. No automated validation against `dbt parse`.

### NFR-H2: SQL Access Query Latency

> **Scale:** Time to first row returned for a SQL query via external client
> **Meter:** P95 on datasets under 1M rows connected via psql
> **Must:** < 10 seconds
> **Plan:** < 5 seconds
> **Status:** **Implemented** — pg_duckdb reads Parquet via httpfs

### NFR-H3: PostgreSQL Wire Protocol

> External SQL access SHALL use standard PostgreSQL wire protocol. Any SQL client, BI tool, ODBC/JDBC driver, or ORM SHALL connect without custom drivers.
> **Status:** **Implemented**

### NFR-H4: Query Engine Auto-Sync

> **Scale:** Time from dataset/transform change to query engine view update
> **Meter:** Elapsed time between outbox event and foreign table refresh
> **Must:** < 60 seconds
> **Plan:** < 30 seconds
> **Status:** **Implemented** — event-driven sync via outbox pattern

### NFR-H5: S3 Cleanup on Delete

> When a dataset or project is deleted, corresponding Parquet files in S3 SHALL be removed.
> **Status:** **Not implemented** — tracked in `s3-lifecycle-cleanup` proposal

---

## Security

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-SEC1 | All API endpoints require authentication except health checks and auth flow | **Implemented** |
| NFR-SEC2 | JWT tokens validated via JWKS in production (WorkOS) | **Implemented** |
| NFR-SEC3 | Backend trusts proxy headers only when TRUST_PROXY_HEADERS is set | **Implemented** |
| NFR-SEC4 | CORS restricted to configured origins | **Implemented** |
| NFR-SEC5 | Org-less users blocked from all endpoints except /api/orgs | **Implemented** |
| NFR-SEC6 | Parquet files encrypted at rest via SSE-S3 or SSE-KMS | **Not configured** |
| NFR-SEC7 | SQL credentials stored as hashed passwords; 60s regeneration cooldown | **Implemented** |

## Multi-Tenancy

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-MT1 | All queries scoped by org_id via RestrictedSession | **Implemented** |
| NFR-MT2 | Query engine schemas isolated per project | **Implemented** |
| NFR-MT3 | Per-org rate limiting on upload and chat endpoints | **Not implemented** |

## Reliability

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-R1 | Outbox pattern for at-least-once event delivery | **Implemented** |
| NFR-R2 | Health check endpoints on all services | **Implemented** |
| NFR-R3 | Graceful shutdown on SIGTERM/SIGINT for agent | **Implemented** |
| NFR-R4 | Forward-compatible database migrations | **Implemented** |

## Observability

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-O1 | Structured logging on auth failures | **Implemented** |
| NFR-O2 | Tool call execution logged with name, duration, success/failure | **Not implemented** |
| NFR-O3 | Upload state machine with structured events | **Partial** |

## Build & Development

| ID | Requirement | Status |
|----|-------------|--------|
| NFR-B1 | All services start with `docker compose up` | **Implemented** |
| NFR-B2 | Docker images built by Bazel | **Implemented** |
| NFR-B3 | CI runs unit tests (Vitest + pytest) on every PR | **Implemented** |
| NFR-B4 | E2E tests runnable in CI with Docker Compose | **Not wired** |
| NFR-B5 | Dev/prod parity (SQLite+MinIO dev, PostgreSQL+S3 prod) | **Implemented** |
