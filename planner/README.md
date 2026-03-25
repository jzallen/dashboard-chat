# Dashboard Layout Planner

A multi-agent pipeline that generates interactive [Vizro](https://vizro.readthedocs.io/) dashboards from natural language prompts. Given a semantic manifest describing your data (sources, metrics, dimensions) and a plain-English request, the planner produces a structured dashboard plan and can serve it as a live dashboard.

## How It Works

The planner uses a **LangGraph StateGraph** to coordinate four LLM agents and an assembler. The pipeline supports both creating dashboards from scratch and editing existing ones.

### Pipeline Flow

```
                    ┌─────────────────┐
                    │  planner_agent  │  Decides section structure
                    └────────┬────────┘
                             │
                ┌────────────┼────────────┐
                │ fan-out    │             │
                ▼            ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌────────────┐
        │ section   │  │ section   │  │  filter    │  Parallel execution
        │ agent (1) │  │ agent (N) │  │  agent     │
        └─────┬─────┘  └─────┬─────┘  └─────┬──────┘
              │              │               │
              └──────────────┴───────────────┘
                             │ fan-in
                    ┌────────▼────────┐
                    │    assembler    │  Merges results (pure code)
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │validation_agent │  Checks integrity
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  approved?      │
                    │  yes → done     │
                    │  no  → retry    │  (max 2 retries)
                    └─────────────────┘
```

### Agents

| Agent | Role | LLM Output Schema |
|-------|------|-------------------|
| **Planner** | Decides how many sections the dashboard needs, their titles, purpose, and which metrics/dimensions each uses. For edits, marks sections as `keep`, `modify`, `add`, or `remove`. | `PlannerOutput` (list of `SectionOutline`) |
| **Section** (×N) | Designs each section's components (charts, tables, text) and grid layout. One instance runs per section via LangGraph `Send()` fan-out. | `SectionPlan` |
| **Filter** | Selects sidebar filters (dropdowns, sliders, date pickers) appropriate for the data and prompt. | `FilterOutput` |
| **Validation** | Two-phase check: (1) pure-code referential integrity and grid validation, (2) LLM coherence review. On failure, errors feed back to the planner for a retry. | `ValidationOutput` |

The **Assembler** is pure code (no LLM). It merges section results, preserves `keep` sections from existing plans, applies `remove` actions, and combines filters and data source references into a `DashboardPlan`.

### State

The pipeline shares state via `PlannerState` (a TypedDict):

| Field | Description |
|-------|-------------|
| `user_prompt` | Natural language request |
| `manifest` | Semantic manifest (data sources, metrics, dimensions) |
| `existing_plan` | Previous plan when editing (optional) |
| `section_plan` | Planner agent output (section outlines) |
| `section_results` | Accumulated section agent outputs (append-reducer for fan-in) |
| `filter_results` | Filter agent output |
| `assembled_plan` | Merged plan from assembler |
| `validation_errors` | Errors from validation (fed back on retry) |
| `final_plan` | Approved plan or best-effort after max retries |
| `iteration_count` | Current retry count |

## Data Model

### Input: Semantic Manifest

Describes your data using concepts aligned with dbt/MetricFlow:

```json
{
  "data_sources": [
    { "id": "orders", "label": "Orders", "columns": [
      { "id": "order_date", "label": "Order Date", "type": "date" },
      { "id": "revenue", "label": "Revenue", "type": "number" }
    ]}
  ],
  "metrics": [
    { "id": "total_revenue", "label": "Total Revenue", "expression": "SUM(revenue)", "type": "simple" }
  ],
  "dimensions": [
    { "id": "order_month", "label": "Order Month", "column_id": "order_date", "type": "time", "time_granularity": "month" }
  ],
  "relationships": []
}
```

### Output: Dashboard Plan

A renderer-agnostic layout specification:

```json
{
  "version": "1.0",
  "title": "Revenue Dashboard",
  "data_source_ids": ["orders"],
  "filters": [
    { "dimension_id": "order_month", "widget_type": "date_picker", "label": "Month" }
  ],
  "sections": [
    {
      "id": "revenue_overview",
      "title": "Revenue Overview",
      "components": [
        { "id": "rev_chart", "type": "chart", "spec": {
          "chart_type": "line", "title": "Monthly Revenue",
          "x_axis": "order_month", "y_axis": "total_revenue"
        }}
      ],
      "grid": [[0]]
    }
  ]
}
```

**Component types**: `chart` (bar, line, area, scatter, pie, histogram, kpi_card), `table`, `text` (header, card, body).

**Filter widgets**: dropdown, checklist, slider, range_slider, date_picker.

## Usage

### Prerequisites

```bash
cd planner && uv sync
export PLANNER_ANTHROPIC_API_KEY=sk-ant-...
```

### Generate a Plan

```bash
planner plan "Show me a revenue dashboard with monthly trends and a breakdown by region" \
  -m manifest.json \
  -o plan.json
```

To edit an existing plan:

```bash
planner plan "Add a customer retention section" \
  -m manifest.json \
  -e plan.json \
  -o plan_v2.json
```

### Serve a Dashboard

```bash
planner serve plan.json -m manifest.json
```

This converts the plan into a live Vizro dashboard using Plotly charts.

## Configuration

Environment variables (all prefixed with `PLANNER_`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PLANNER_ANTHROPIC_API_KEY` | — | Required. Anthropic API key. |
| `PLANNER_MODEL` | `claude-sonnet-4-6` | Claude model to use. |
| `PLANNER_TEMPERATURE` | `0.1` | LLM temperature. |

## Project Structure

```
planner/
├── planner/
│   ├── cli.py                  # Click CLI (plan + serve commands)
│   ├── config.py               # PlannerSettings (Pydantic)
│   ├── agents/
│   │   ├── orchestrator.py     # LangGraph StateGraph wiring
│   │   ├── planner_agent.py    # Section structure planning
│   │   ├── section_agent.py    # Per-section component design
│   │   ├── filter_agent.py     # Sidebar filter selection
│   │   ├── validation_agent.py # Integrity + coherence checks
│   │   ├── assembler.py        # Merges agent outputs (no LLM)
│   │   └── prompts/            # LLM prompt templates
│   ├── schema/
│   │   ├── manifest.py         # SemanticManifest (input)
│   │   ├── plan.py             # DashboardPlan (output)
│   │   └── vizro_builder.py    # Plan → Vizro Dashboard conversion
│   ├── renderer/
│   │   ├── app.py              # Vizro app server
│   │   ├── data_manager.py     # Data source registration
│   │   └── charts.py           # Chart utilities
│   └── data/
│       ├── warehouse.py        # Abstract WarehouseRepository
│       ├── types.py            # SemanticQuery / SemanticQueryResult
│       └── hardcoded_warehouse.py  # Synthetic data for dev/demo
├── tests/
│   ├── test_agents/            # Agent unit tests
│   ├── fixtures/               # Sample manifest + plan JSON
│   └── ...
└── pyproject.toml
```

## Testing

```bash
cd planner && uv run pytest
```

Tests use `pytest-asyncio` with `asyncio_mode = "auto"`.
