# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) using the [MADR](https://adr.github.io/madr/) format. Each ADR documents a significant architectural choice, the context that drove it, alternatives considered, and consequences.

## Decisions

| ID | Title | Status |
|----|-------|--------|
| [ADR-001](adr-001-hono-over-express.md) | Hono over Express for Chat Worker | Accepted |
| [ADR-002](adr-002-groq-over-openai.md) | Groq over OpenAI for LLM Inference | Accepted |
| [ADR-003](adr-003-duckdb-pg-duckdb-analytics.md) | DuckDB / pg_duckdb for Analytical Queries | Accepted |
| [ADR-004](adr-004-sse-over-websocket.md) | SSE over WebSocket for Chat Streaming | Accepted |
| [ADR-005](adr-005-frozen-dataclasses-over-pydantic.md) | Frozen Dataclasses over Pydantic for Domain Models | Accepted |
| [ADR-006](adr-006-result-monad-over-exceptions.md) | Result Monad over Exceptions for Error Flow | Accepted |
| [ADR-007](adr-007-ibis-for-sql-generation.md) | Ibis for SQL Generation over Raw SQL | Accepted |
| [ADR-008](adr-008-minio-s3-file-storage.md) | MinIO / S3 for File Storage over Local Filesystem | Accepted |
| [ADR-009](adr-009-tanstack-query-over-redux.md) | TanStack Query over Redux/Zustand for Server State | Accepted |
| [ADR-010](adr-010-bazel-over-pure-turborepo.md) | Bazel over Pure Turborepo for Build Orchestration | Accepted |
| [ADR-011](adr-011-dual-llm-strategy.md) | Dual LLM Strategy -- Groq for Chat, Anthropic for Planning | Accepted |
| [ADR-012](adr-012-synthetic-first-healthcare.md) | Synthetic-First Healthcare Strategy via Synthea | Proposed |
| [ADR-013](adr-013-nwave-adoption.md) | Adopt nwave-ai as the SDLC framework | Accepted |
| [ADR-014](adr-014-chatevent-vocabulary-stratification.md) | ChatEvent Vocabulary Stratification — Two Parallel Unions in `shared/chat/` | Ratified |
| [ADR-015](adr-015-headless-presentation-state-retrieval.md) | Headless Presentation-State Retrieval — Reflect-Only Directive Log | Ratified |
| [ADR-016](adr-016-auth-proxy-in-test-stack.md) | Auth-Proxy in the api-driven-user-flow-tests Compose Stack | Ratified |
| [ADR-017](adr-017-session-event-reader-dispatch.md) | SessionEventReader Dispatch — Redis-default, Stream.io-optional | Ratified |
