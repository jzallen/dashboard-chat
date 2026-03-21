## Why

We need a feature that generates Vizro (Plotly Dash) dashboard layouts from natural language prompts. Rather than a single LLM call that non-deterministically produces an entire dashboard, we decompose the problem into a multi-agent pipeline using LangChain/LangGraph. Each agent handles a narrow sub-problem with structured output. The output is a validated Vizro dashboard configuration (Pydantic models / JSON) that is auditable, editable, and directly renderable.

Vizro was chosen over custom Streamlit because it's Pydantic-first (models → JSON → rendered dashboard), LLM-proven via McKinsey's Vizro-MCP server, and provides built-in schema validation, KPI cards, filters, charts, tables, and grid/flex layouts.

## What Changes

- New `planner/` Python package (standalone service alongside existing backend/frontend/worker)
- Multi-agent LangGraph pipeline: planner → parallel section agents + filter agent → assembler → validation
- Pydantic schema for semantic manifests (dbt/MetricFlow-aligned), intermediate dashboard plans, and Vizro model conversion
- Warehouse repository abstraction for data queries (MetricFlow-style: metrics + group_by → tabular rows)
- Hardcoded/synthetic warehouse implementation for initial development
- Vizro renderer that converts plans to live dashboards
- Click CLI for plan generation (`planner plan`) and dashboard serving (`planner serve`)
- Edit workflow: modify existing dashboard plans via natural language

## Capabilities

### New Capabilities
- `semantic-manifest-schema`: Pydantic models for describing available data sources, metrics, dimensions, and relationships (dbt/MetricFlow-aligned)
- `dashboard-plan-schema`: Intermediate plan format (charts, tables, text, sections, filters, grid layouts) that LLM agents produce and Vizro builder consumes
- `warehouse-repository`: Abstract data query interface (SemanticQuery → SemanticQueryResult) with hardcoded dev implementation
- `agent-pipeline`: LangGraph orchestrator with parallel section sub-agents, filter agent, assembler, and validation agent using structured output
- `vizro-renderer`: Converts DashboardPlan → Vizro Dashboard model, registers data sources, builds Plotly charts, and serves dashboards
- `planner-cli`: Click CLI for generating plans from prompts and serving rendered dashboards

### Modified Capabilities
<!-- No existing capabilities are modified — this is an entirely new subsystem -->

## Impact

- **New service**: `planner/` with its own `pyproject.toml`, managed by `uv`
- **Dependencies**: langchain-core, langgraph, langchain-anthropic, vizro, plotly, pandas, pydantic-settings, click
- **External APIs**: Anthropic Claude API (claude-sonnet-4-6) for LLM calls
- **No impact on existing services**: frontend, backend, worker, and shared are unchanged
- **Future integration point**: The planner output (JSON) can be consumed by the frontend or served standalone via Vizro
