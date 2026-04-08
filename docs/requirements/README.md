# Non-Functional Requirements

Requirements organized by the prototyping workflow (Upload --> Model --> Preview --> Handoff) plus cross-cutting concerns. Each uses the format best suited to its nature:

- **Planguage** (Scale/Meter/Must/Plan) for measurable targets
- **Quality Attribute Scenarios** for behavioral requirements
- **Declarative invariants** for binary constraints

Status tags: **Implemented**, **Partial**, **Not implemented**, **Not measured**

---

## Stage 1: Upload

| ID | Title | Format | Status |
|----|-------|--------|--------|
| [NFR-U1](nfr-u1-upload-size-limit.md) | Upload Size Limit | Planguage | Not implemented |
| [NFR-U2](nfr-u2-time-to-preview.md) | Time to Preview | Planguage | Implemented |
| [NFR-U3](nfr-u3-multi-sheet-confirmation.md) | Multi-Sheet Confirmation | QAS | Implemented |
| [NFR-U4](nfr-u4-format-extensibility.md) | Format Extensibility | Invariant | Implemented |

## Stage 2: Model with Natural Language

| ID | Title | Format | Status |
|----|-------|--------|--------|
| [NFR-M1](nfr-m1-chat-responsiveness.md) | Chat Responsiveness | Planguage | Implemented |
| [NFR-M2](nfr-m2-transform-preview-latency.md) | Transform Preview Latency | Planguage | Implemented |
| [NFR-M3](nfr-m3-non-destructive-exploration.md) | Non-Destructive Exploration | Invariant | Implemented |
| [NFR-M4](nfr-m4-llm-provider-failure-handling.md) | LLM Provider Failure Handling | QAS | Not implemented |
| [NFR-M5](nfr-m5-report-context-routing.md) | Report Context Routing | Invariant | Not implemented |

## Stage 3: Preview (Planned)

| ID | Title | Format | Status |
|----|-------|--------|--------|
| [NFR-P1](nfr-p1-dashboard-generation-time.md) | Dashboard Generation Time | Planguage | Not measured |
| [NFR-P2](nfr-p2-hot-reload-latency.md) | Hot Reload Latency | Planguage | Not implemented |
| [NFR-P3](nfr-p3-dashboard-interaction-latency.md) | Dashboard Interaction Latency (Local-First) | Planguage | Not implemented |
| [NFR-P4](nfr-p4-extract-load-time.md) | Extract Load Time | Planguage | Not implemented |
| [NFR-P5](nfr-p5-manifest-auto-generation.md) | Manifest Auto-Generation | Invariant | Not implemented |

## Stage 4: Handoff

| ID | Title | Format | Status |
|----|-------|--------|--------|
| [NFR-H1](nfr-h1-dbt-export-validity.md) | dbt Export Validity | QAS | Implemented |
| [NFR-H2](nfr-h2-sql-access-query-latency.md) | SQL Access Query Latency | Planguage | Implemented |
| [NFR-H3](nfr-h3-postgresql-wire-protocol.md) | PostgreSQL Wire Protocol | Invariant | Implemented |
| [NFR-H4](nfr-h4-query-engine-auto-sync.md) | Query Engine Auto-Sync | Planguage | Implemented |
| [NFR-H5](nfr-h5-s3-cleanup-on-delete.md) | S3 Cleanup on Delete | Invariant | Not implemented |

## Cross-Cutting

| Category | File | Items |
|----------|------|-------|
| [Security](nfr-sec-security.md) | NFR-SEC1 through SEC7 | 7 |
| [Multi-Tenancy](nfr-mt-multi-tenancy.md) | NFR-MT1 through MT3 | 3 |
| [Reliability](nfr-r-reliability.md) | NFR-R1 through R4 | 4 |
| [Observability](nfr-o-observability.md) | NFR-O1 through O3 | 3 |
| [Build & Development](nfr-b-build-and-development.md) | NFR-B1 through B5 | 5 |
