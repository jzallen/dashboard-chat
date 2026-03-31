## 1. Project Setup

- [x] 1.1 Create `planner/` directory with `pyproject.toml` (dependencies: langchain-core, langgraph, langchain-anthropic, pydantic, pydantic-settings, click, vizro, plotly, pandas; dev: pytest, pytest-asyncio, ruff)
- [x] 1.2 Create package structure: `planner/planner/` with `__init__.py` for all subpackages (schema, agents, agents/prompts, data, renderer)
- [x] 1.3 Create test structure: `planner/tests/` with `__init__.py`, `conftest.py`, `test_agents/`, `fixtures/`
- [x] 1.4 Run `uv sync` to install dependencies and verify the package is importable

## 2. Schema Models

- [x] 2.1 Implement `schema/manifest.py` — Column, Metric, Dimension, DataSource, Relationship, SemanticManifest Pydantic models
- [x] 2.2 Implement `schema/plan.py` — ChartSpec, TableSpec, TextSpec, ComponentSpec, SectionPlan, FilterSpec, DashboardPlan Pydantic models
- [x] 2.3 Create `tests/fixtures/sample_manifest.json` — realistic semantic manifest fixture (healthcare domain)
- [x] 2.4 Create `tests/fixtures/sample_dashboard_plan.json` — matching dashboard plan fixture
- [x] 2.5 Write `tests/test_schema.py` — round-trip serialization, default values, validation error cases for both manifest and plan models

## 3. Warehouse Abstraction

- [x] 3.1 Implement `data/types.py` — SemanticQuery, ColumnMetadata, SemanticQueryResult models
- [x] 3.2 Implement `data/warehouse.py` — abstract WarehouseRepository (query, list_dimension_values)
- [x] 3.3 Implement `data/hardcoded_warehouse.py` — HardcodedWarehouseRepository returning synthetic data based on manifest field types
- [x] 3.4 Write `tests/test_warehouse.py` — query returns correct column types, list_dimension_values respects limit

## 4. Vizro Builder and Renderer

- [x] 4.1 Implement `schema/vizro_builder.py` — `build_vizro_dashboard(DashboardPlan, SemanticManifest) -> vm.Dashboard` with component and filter conversion
- [x] 4.2 Implement `renderer/charts.py` — Plotly figure builder functions (bar, line, area, scatter, pie, histogram, kpi_card) and chart registry
- [x] 4.3 Implement `renderer/data_manager.py` — `register_data_sources` connecting warehouse queries to Vizro data manager
- [x] 4.4 Implement `renderer/app.py` — `serve(plan_path, manifest_path)` that builds and runs the Vizro app
- [x] 4.5 Write `tests/test_renderer.py` — verify build_vizro_dashboard produces valid Vizro models, chart functions return Plotly figures

## 5. Configuration

- [x] 5.1 Implement `config.py` — PydanticSettings with PLANNER_ prefix (anthropic_api_key, model, temperature)

## 6. Agent Prompts

- [x] 6.1 Implement `agents/prompts/planner.py` — system/user prompt templates for section structure planning
- [x] 6.2 Implement `agents/prompts/section.py` — system/user prompt templates for per-section component generation
- [x] 6.3 Implement `agents/prompts/filter.py` — system/user prompt templates for filter selection
- [x] 6.4 Implement `agents/prompts/validation.py` — system/user prompt templates for coherence checking

## 7. Agent Nodes

- [x] 7.1 Implement `agents/planner_agent.py` — planner node using structured output for section outlines, with edit-mode support (keep/modify/add/remove)
- [x] 7.2 Implement `agents/section_agent.py` — section node producing SectionPlan with components, specs, and grid layout
- [x] 7.3 Implement `agents/filter_agent.py` — filter node producing list of FilterSpec entries
- [x] 7.4 Implement `agents/assembler.py` — pure code assembler merging section_results + filter_results into DashboardPlan
- [x] 7.5 Implement `agents/validation_agent.py` — validation node checking referential integrity and structural coherence

## 8. Orchestrator

- [x] 8.1 Implement `agents/orchestrator.py` — LangGraph StateGraph with PlannerState, Send() fan-out, conditional retry (max 2), and final_plan output

## 9. Agent Tests

- [x] 9.1 Write `tests/test_agents/test_planner_agent.py` — mock LLM, verify section outline structure for new and edit workflows
- [x] 9.2 Write `tests/test_agents/test_section_agent.py` — mock LLM, verify SectionPlan output with valid component specs
- [x] 9.3 Write `tests/test_agents/test_filter_agent.py` — mock LLM, verify FilterSpec output with correct widget types
- [x] 9.4 Write `tests/test_agents/test_assembler.py` — test merging multiple sections + filters, test edit preservation
- [x] 9.5 Write `tests/test_agents/test_validation_agent.py` — test valid plan passes, invalid reference detected
- [x] 9.6 Write `tests/test_agents/test_orchestrator.py` — mock all agents, verify full pipeline execution and retry behavior

## 10. CLI

- [x] 10.1 Implement `cli.py` — Click group with `plan` command (prompt, -m manifest, -e existing, -o output) and `serve` command (plan_path, -m manifest)
- [x] 10.2 Verify CLI entry point: `planner plan "..." -m fixtures/sample_manifest.json -o /tmp/plan.json` runs without import errors (LLM call may fail without API key)
