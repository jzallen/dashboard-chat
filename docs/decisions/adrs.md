# Architecture Decision Records

## ADR-001: Hono over Express for Chat Worker

**Status:** Accepted  
**Context:** The chat agent needs a lightweight HTTP framework that handles SSE streaming efficiently and can deploy to edge runtimes (Cloudflare Workers).  
**Decision:** Use Hono instead of Express.  
**Rationale:** Hono is built for edge runtimes with zero Node.js-specific APIs, has native Request/Response support (Web Standards), and includes middleware for CORS and auth out of the box. Express requires polyfills for Workers and has no native streaming support.  
**Consequences:** Worker code uses Web API patterns (`new Response()`, `ReadableStream`) rather than Node.js streams. Hono's middleware API differs from Express — simpler but less ecosystem support.

---

## ADR-002: Groq over OpenAI for LLM Inference

**Status:** Accepted  
**Context:** The chat agent needs fast LLM inference with tool-calling support for real-time table operations.  
**Decision:** Use Groq API with `llama-3.3-70b-versatile` as the primary model.  
**Rationale:** Groq's inference hardware delivers sub-second time-to-first-token, critical for a chat UX where users expect immediate feedback. The model supports structured tool calling with Zod schemas via the Vercel AI SDK.  
**Consequences:** Vendor lock-in to Groq's model catalog. Model quality differs from GPT-4/Claude — acceptable for structured tool calling but may need upgrading for more complex reasoning tasks. The `@ai-sdk/groq` adapter abstracts the provider, making migration feasible.

---

## ADR-003: DuckDB / pg_duckdb for Analytical Queries

**Status:** Accepted  
**Context:** Users need to query Parquet files stored in S3/MinIO with SQL, both internally (preview) and externally (SQL access).  
**Decision:** Use DuckDB for in-process analytics and pg_duckdb for external SQL access via PostgreSQL wire protocol.  
**Rationale:** DuckDB reads Parquet natively via `read_parquet()` without ETL. pg_duckdb exposes DuckDB's engine through PostgreSQL, letting external tools (DBeaver, psql, BI tools) connect using standard drivers. The `httpfs` extension reads directly from S3.  
**Consequences:** Two query paths: in-process DuckDB (via Ibis) for previews, and pg_duckdb for external access. Schema synchronization between the two requires explicit sync operations.

---

## ADR-004: SSE over WebSocket for Chat Streaming

**Status:** Accepted  
**Context:** Chat responses stream token-by-token with interleaved tool calls.  
**Decision:** Use Server-Sent Events (SSE) instead of WebSocket.  
**Rationale:** SSE is simpler — it's HTTP-native, works through standard proxies/CDNs, and requires no connection upgrade handshake. The chat pattern is inherently unidirectional (server→client streaming) after the initial request. The Vercel AI SDK's `streamText().toDataStreamResponse()` produces SSE natively.  
**Consequences:** Each message requires a new HTTP POST (no persistent connection). This is acceptable because chat messages are discrete request-response pairs. Real-time bidirectional features (typing indicators, presence) are handled by Stream.io instead.

---

## ADR-005: Frozen Dataclasses over Pydantic for Domain Models

**Status:** Accepted  
**Context:** Domain models need to represent business entities with invariants and behavior.  
**Decision:** Use `@dataclass(frozen=True, slots=True)` for domain models instead of Pydantic `BaseModel`.  
**Rationale:** Frozen dataclasses enforce immutability at the language level — preventing accidental state mutation. Slots reduce memory overhead. Domain models contain business logic (e.g., `Dataset._build_table()`) that doesn't fit Pydantic's validation-centric design. Pydantic is still used for request/response schemas in the router layer where validation is the primary concern.  
**Consequences:** Two model layers: Pydantic schemas (HTTP boundary) and frozen dataclasses (domain). Conversion happens in the controller via `from_record()` and `serialize()` methods.

---

## ADR-006: Result Monad over Exceptions for Error Flow

**Status:** Accepted  
**Context:** Use cases need to communicate success and failure without relying on exception-based control flow.  
**Decision:** Use the `returns` library's `Result[Success, Failure]` pattern via `@handle_returns`.  
**Rationale:** Explicit result types make error paths visible in the type signature. The controller can pattern-match on failure types to map domain errors to HTTP status codes. Exceptions are reserved for truly exceptional conditions (DB connection failure, S3 timeout).  
**Consequences:** Every use case returns `Result`, and callers must handle both cases. `@handle_returns` auto-wraps raised exceptions into `Failure`, providing a safety net. Testing uses `isinstance(result.failure(), SomeDomainException)`.

---

## ADR-007: Ibis for SQL Generation over Raw SQL

**Status:** Accepted  
**Context:** Datasets need a composable query pipeline that applies transforms (clean, filter, rename) to Parquet files.  
**Decision:** Use Ibis expressions to build SQL programmatically.  
**Rationale:** Ibis provides a pandas-like API that compiles to SQL without executing queries. The 3-stage pipeline (MUTATE → FILTER → RENAME) is naturally expressed as chained Ibis operations. Ibis is dialect-agnostic — the same expressions compile to DuckDB SQL for previews and PostgreSQL-compatible SQL for external access.  
**Consequences:** Adds Ibis as a dependency. SQL debugging requires inspecting compiled output rather than hand-written queries. Complex transforms may need raw SQL escape hatches.

---

## ADR-008: MinIO / S3 for File Storage over Local Filesystem

**Status:** Accepted  
**Context:** Uploaded files and converted Parquet datasets need durable storage accessible by multiple services.  
**Decision:** Use S3-compatible object storage (MinIO in dev, S3 in production).  
**Rationale:** Object storage decouples file access from any single service instance. Both DuckDB (`httpfs`) and pg_duckdb can read Parquet directly from S3. MinIO provides a local S3-compatible development experience with a web console for debugging.  
**Consequences:** File operations use boto3/aioboto3 S3 API. Storage paths follow a convention: `datasets/{project_id}/{dataset_id}/`. All services need S3 credentials configured.

---

## ADR-009: TanStack Query over Redux/Zustand for Server State

**Status:** Accepted  
**Context:** The frontend needs to manage server state (datasets, projects, views) with caching, invalidation, and optimistic updates.  
**Decision:** Use TanStack Query for all server state management.  
**Rationale:** TanStack Query treats server state as a cache rather than application state. Key factories (`projectKeys.detail(id)`) provide structured cache invalidation. Built-in features (stale-while-revalidate, background refetching, retry) eliminate boilerplate. Client-only state (UI toggles, form state) uses React's built-in state primitives.  
**Consequences:** No global state store (Redux/Zustand). Components declare their data dependencies via hooks. Tests require a `QueryClientProvider` wrapper.

---

## ADR-010: Bazel over Pure Turborepo for Build Orchestration

**Status:** Accepted  
**Context:** The monorepo contains Python (backend), TypeScript (frontend, agent, auth-proxy), and shared configs. Builds need to be reproducible and cacheable across languages.  
**Decision:** Use Bazel as the primary build system, with Turborepo for JavaScript-specific task orchestration.  
**Rationale:** Bazel provides hermetic builds, cross-language dependency tracking, and Docker image generation (`dashboard-chat/*:bazel` images). Turborepo handles npm workspace tasks (`test`, `build`, `dev`) where Bazel's overhead isn't justified.  
**Consequences:** Two build systems to maintain. `BUILD.bazel` and `MODULE.bazel` define Bazel targets. `turbo.json` defines JS pipeline tasks. Default-profile Docker images are built by Bazel for reproducibility. The optional `api-full` service in the "full" profile uses a traditional Dockerfile for hot-reload development.

---

## ADR-011: Dual LLM Strategy — Groq for Chat, Anthropic for Planning

**Status:** Accepted  
**Context:** The system has two distinct LLM workloads with different requirements. Real-time chat needs low-latency tool calling (sub-second first token). Dashboard layout planning needs high-quality multi-step reasoning over complex data manifests.  
**Decision:** Use Groq (llama-3.3-70b-versatile) for the chat agent and Anthropic Claude (claude-sonnet-4-6) for the layout planner.  
**Rationale:** Groq's inference speed is essential for the chat UX — users type a message and expect immediate streaming feedback. The layout planner runs as a batch pipeline (planner → section → filter → assembler → validation) where latency is less critical but reasoning quality determines output fidelity. Claude excels at the structured, multi-step reasoning the LangGraph pipeline requires. Using two providers also avoids single-vendor dependency.  
**Consequences:** Two API keys to manage (`GROQ_API_KEY`, `PLANNER_ANTHROPIC_API_KEY`). Two SDK dependencies (`@ai-sdk/groq` in TypeScript, `anthropic` in Python). The planner service is currently standalone (`planner/`) and not yet integrated into the main application's Docker Compose or API surface.
