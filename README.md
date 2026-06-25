# Dashboard Chat

**A chat-first prototyping tool for data models and dashboards.** Upload raw files
(or synthetic data), shape a data model entirely through natural language, preview a
live dashboard, then hand off a working dbt project and renderable dashboard code to
your engineering teams.

It's built for people who have domain expertise and maybe know some SQL, but don't
want to stand up data infrastructure just to explore an idea.

> 📖 **[Read the full product vision](docs/vision.md)** — the prototyping workflow,
> target users, healthcare/Synthea strategy, and handoff model.

## The Prototyping Workflow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   1. UPLOAD  │    │  2. MODEL    │    │  3. PREVIEW  │    │  4. HANDOFF  │
│              │───►│              │───►│              │───►│              │
│  CSV, Excel, │    │ Clean, join, │    │ Live dashboard│   │ dbt project  │
│  Synthea,    │    │ filter, view │    │ preview with  │   │ + renderable │
│  FHIR        │    │ via chat     │    │ hot reload    │   │ dashboard    │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
   COMPLETE            COMPLETE            PLANNED          dbt COMPLETE
                  (reports in progress)
```

1. **Upload** — Drop in structured files. The system auto-detects format, converts to
   Parquet, stores it in S3-compatible object storage, and generates previews with
   column profiles. Supported: CSV, Excel (`.xlsx`/`.xls`), JSON, Parquet, FHIR bundles.
   For healthcare prototyping, generate synthetic patient populations with
   [Synthea](https://github.com/synthetichealth/synthea) and upload the output directly —
   no PHI ever enters the system.

2. **Model with natural language** — With a dataset loaded, every operation happens
   through chat: clean (trim, standardize casing, fill nulls), filter, transform
   (rename, sort, add/delete rows), build views (join datasets, set grain and
   materialization), and build reports (dimensions, measures, aggregations — *backend
   ready, agent tools in progress*). Every operation is a reproducible transform in a
   3-stage Ibis pipeline (MUTATE → FILTER → RENAME). Nothing is destructive — the raw
   Parquet is never modified, and transforms can be disabled and re-enabled.

3. **Preview** *(planned)* — The agent first proposes a cheap grid-layout mockup in
   chat (sub-2s via Groq) so you can rearrange the layout before any expensive
   generation. Once confirmed, the planner generates renderable Vizro code that renders
   in a separate preview tab with hot reload. Dashboard interactions run locally against
   a DuckDB WASM instance in the browser for sub-10ms drill-downs.

4. **Handoff** — The prototype produces artifacts engineers already know how to use:
   - **dbt project** → data engineers — a 4-layer dbt archive (sources → staging →
     intermediate → marts) with YAML schemas, macros, model SQL, and `profiles.yml`.
     `dbt run` works out of the box.
   - **Renderable dashboard code** *(planned)* → software engineers — generated Vizro
     Python, not a screenshot, that can be connected to real data and deployed.
   - **SQL access** → analysts — enable SQL on a project to provision a `pg_duckdb`
     schema with foreign tables, reachable from any client over the PostgreSQL wire
     protocol.

## What Makes This Different

1. **Prototyping, not production** — The output is a handoff artifact, not a hosted
   analytics platform. Users sketch ideas; engineers build the real thing.
2. **Chat-native** — Every operation, from cleaning to dashboard design, is natural
   language. The LLM sees the actual schema and emits structured tool calls, not raw SQL.
3. **Non-destructive exploration** — All operations are reversible. Raw Parquet is never
   mutated.
4. **Live preview with hot reload** — The feedback loop is seconds, not sprint cycles.
5. **Standard handoff formats** — dbt projects and renderable Vizro code, not
   proprietary exports.
6. **Synthetic-first for healthcare** — Prototype against Synthea data, hand off to
   engineers who connect real EHR data. No PHI in the prototyping environment.

## Architecture

Dashboard Chat is a multi-service monorepo. Source-tree directories are named for the
**body of source** they contain; Docker Compose services are named for their **runtime
role** — the two layers are intentionally decoupled (see
[ADR-033](docs/decisions/adr-033-source-tree-topology-separation.md)).

| Service | Stack | Responsibility |
|---|---|---|
| **Frontend** (`ui/`) | React 18 + React Router v7 (framework mode) | Chat panel + preview tab |
| **Agent** (`agent/`) | Hono (Node.js) | Chat API with SSE streaming via Groq + tool calling |
| **Backend** (`backend/`) | FastAPI + SQLAlchemy (async) + DuckDB + Alembic | REST endpoints, upload pipeline, transforms, dbt export |
| **Auth-Proxy** (`auth-proxy/`) | Hono (Node.js) | JWT verification, M2M token minting, identity-header injection, multi-upstream routing |
| **UI-State** (`ui-state/`) | Hono + XState v5 actor system + Redis | Backend-for-frontend holding flow state across machines |
| **Planner** (`planner/`) | LangGraph multi-agent (Claude) | Vizro dashboard code generation *(planned integration)* |
| **Shared** (`shared/chat/`) | TypeScript | Single source of truth for the chat event schema, imported by `agent/` and `ui/` |

**Supporting infrastructure:** `pg_duckdb` (analytical query engine over Parquet via
`httpfs`), MinIO (S3-compatible object storage), PostgreSQL (metadata), and an optional
Mirth Connect integration (HL7v2 → FHIR) under the `healthcare` Compose profile.

**External services:** Groq (fast LLM inference, `llama-3.3-70b-versatile`), Anthropic
(`claude-sonnet-4-6`, planner generation), WorkOS (production SSO + directory sync),
Stream.io (chat persistence), and Synthea (synthetic patient data, external CLI).

```
        Browser (chat + preview)
              │
              ▼
   ┌──────────────────────┐   POST /chat (SSE)   ┌──────────┐    ┌──────────┐
   │   Frontend  (ui/)     │ ───────────────────► │  Agent   │──► │   Groq   │
   │   React 18 / RRv7     │ ◄─────────────────── │  (Hono)  │    └──────────┘
   └──────────────────────┘     REST API          └──────────┘
              │
              ▼
   ┌──────────────────────┐      ┌──────────────┐      ┌──────────────┐
   │   Backend (FastAPI)   │ ───► │   pg_duckdb  │ ───► │    MinIO     │
   │   transforms / dbt    │      │ query engine │ S3   │  (Parquet)   │
   └──────────────────────┘      └──────────────┘      └──────────────┘
              │  dbt export
              ▼
   dbt project → data engineers   |   Vizro code → software engineers
```

See [`docs/architecture/`](docs/architecture/) for the full C4 container diagram,
agent topology, auth flow, and backend/frontend layer breakdowns. Technology choices
are recorded as [ADRs](docs/decisions/README.md).

## Development Methodology

This project follows **[nwave-ai](docs/decisions/adr-013-nwave-adoption.md)** as its
SDLC framework. Features flow through waves (DISCUSS → DESIGN → DISTILL → DELIVER) with
Outside-In TDD and a hexagonal architecture. As a brownfield codebase, work enters at
later waves — see [CLAUDE.md](CLAUDE.md) for the routing matrix, conventions, and the
testing discipline that govern contributions.

## Documentation

- [Product Vision](docs/vision.md) — the prototyping workflow and handoff model
- [Architecture](docs/architecture/) — C4 diagrams, service topology, layer breakdowns
- [Domain](docs/domain/) — entities, dataset lifecycle, tool-call registry
- [API Endpoints](docs/api/endpoints.md) — REST endpoints across the backend routers
- [Architecture Decision Records](docs/decisions/README.md) — technology and design decisions
- [CLAUDE.md](CLAUDE.md) — developer workflow, conventions, and quick commands

## License

MIT
