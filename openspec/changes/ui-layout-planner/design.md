## Context

Dashboard Chat currently supports chat-driven table operations. We're adding a new `planner/` service that generates Vizro dashboard layouts from natural language prompts. The planner is a standalone Python package with no runtime coupling to the existing backend/frontend/worker services. It uses a multi-agent LangGraph pipeline to decompose dashboard generation into narrow, deterministic sub-problems.

The planner receives a user prompt plus a `semantic_manifest.json` describing available data. For edits, it also receives an existing dashboard plan. Data loading uses a warehouse repository abstraction aligned with MetricFlow query semantics.

## Goals / Non-Goals

**Goals:**
- Decompose dashboard generation into a multi-agent pipeline with structured outputs at each stage
- Produce a validated intermediate plan format (DashboardPlan) that is auditable and editable as JSON
- Convert plans deterministically to Vizro Dashboard models for rendering
- Support both new dashboard creation and editing existing dashboards via natural language
- Provide a CLI for plan generation and dashboard serving
- Abstract data access behind a warehouse repository so the LLM pipeline is decoupled from data sources

**Non-Goals:**
- Real-time collaboration or multi-user editing of plans
- Integration with the existing frontend/backend services (future work)
- Production-grade warehouse connectors (only hardcoded/synthetic data for initial dev)
- Custom Vizro component development beyond built-in charts, tables, and KPI cards
- Caching or persistence of LLM responses across runs

## Decisions

### 1. Vizro as the rendering framework

**Decision**: Use Vizro (Plotly Dash) for dashboard rendering instead of custom Streamlit or raw Plotly.

**Rationale**: Vizro is Pydantic-first — its entire dashboard model is a Pydantic hierarchy (Dashboard → Page → Component). This means we can generate JSON that maps directly to a renderable dashboard with built-in schema validation. McKinsey's Vizro-MCP server already proves LLMs can generate valid Vizro configs. Built-in support for KPI cards, filters, charts, tables, and grid/flex layouts.

**Alternatives considered**: Custom Streamlit (requires imperative code generation, not declarative config), raw Plotly Dash (no Pydantic model layer, layout is manual).

### 2. Parallel section sub-agents via LangGraph Send()

**Decision**: The planner agent decides section structure, then section-specific sub-agents run in parallel via LangGraph `Send()`. A deterministic assembler merges results.

**Rationale**: Asking one agent to produce a large JSON blob is unreliable. Decomposing into parallel section agents means each agent handles a bounded problem (one section with a few components). The assembler is pure code with no LLM calls, ensuring deterministic merging.

**Alternatives considered**: Single-agent generation (fragile for complex dashboards), sequential section generation (slower, no parallelism benefit).

### 3. TypedDict for LangGraph state, Pydantic at boundaries

**Decision**: Use TypedDict for LangGraph graph state. Convert Pydantic models to dicts via `.model_dump()` before storing in state. Parse back to Pydantic at agent boundaries.

**Rationale**: Known LangGraph caching bug (#5733) with Pydantic models in state. TypedDict works reliably with LangGraph's state management. Pydantic is still used for structured LLM output and for the public API surface (DashboardPlan, SemanticManifest).

### 4. Intermediate DashboardPlan format

**Decision**: Define our own `DashboardPlan` Pydantic model as the intermediate format between LLM agents and Vizro. A pure-code `vizro_builder.py` converts DashboardPlan → Vizro models.

**Rationale**: The DashboardPlan is simpler than Vizro's full model hierarchy, designed for LLM-friendly generation (flat references by ID, simple grid matrices). It's also renderer-agnostic — if we swap Vizro for something else later, only the builder changes.

### 5. MetricFlow-aligned warehouse abstraction

**Decision**: The warehouse interface uses flat semantic queries: metrics + group_by → tabular rows. Aligned with dbt/MetricFlow conventions (time grain suffixes, SQL-like filters).

**Rationale**: The semantic manifest already uses MetricFlow concepts (metrics, dimensions, data sources). The query interface should match. This also future-proofs integration with actual MetricFlow/dbt Semantic Layer.

### 6. LLM configuration

**Decision**: Use `langchain-anthropic>=1.3` with `claude-sonnet-4-6`, temperature 0.1. Configuration via `pydantic-settings` with `PLANNER_` env prefix.

**Rationale**: Claude Sonnet provides the best balance of structured output quality and cost/speed for this use case. Low temperature (0.1) for deterministic, schema-compliant outputs.

## Risks / Trade-offs

- **[Vizro version coupling]** → Pin to `>=0.1.25` and test against specific Vizro model APIs. Vizro is pre-1.0 so breaking changes are possible. Mitigation: the DashboardPlan intermediate format isolates us — only vizro_builder.py needs updating.

- **[LLM output quality for complex layouts]** → The parallel section decomposition reduces the problem scope per agent, but grid layout matrices may still be tricky. Mitigation: validation agent checks referential integrity and can trigger retries (max 2).

- **[Hardcoded warehouse is not production-ready]** → Intentionally scoped for dev only. The abstract interface is designed for future real implementations. Mitigation: clear interface boundary, synthetic data is typed correctly.

- **[LangGraph Send() complexity]** → Fan-out/fan-in adds graph complexity. Mitigation: the assembler is pure code (no LLM), and each section agent is a self-contained unit testable in isolation.

- **[New standalone service increases monorepo surface]** → The planner is a separate Python package not integrated into the existing turbo/npm workspace graph. Mitigation: it's managed by uv like the backend, with its own pyproject.toml and test suite.
