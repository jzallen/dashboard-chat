# Planner Docker Integration: Live Dashboard Preview with Hot Reload

## Why

The layout planner (`planner/`) is a fully built multi-agent service that generates renderable Vizro dashboard code from natural language prompts. It uses LangGraph with Anthropic Claude (Sonnet) and has a CLI (`plan`, `serve`), tests, and a complete agent pipeline (planner → section → filter → assembler → validation). ADR-011 documents the dual-LLM decision.

But the planner is an island — not in Docker Compose, no API surface for the main application, and critically, no way to generate a semantic manifest from the platform's Views and Reports.

The product vision's Stage 3 (Preview) requires the planner to:
1. Receive a manifest derived from Views and Reports
2. Generate renderable Vizro dashboard code from natural language prompts
3. Render the dashboard in a **separate preview tab** that the user can see alongside the chat
4. Support **hot reload** — when the user refines the dashboard via chat, the preview updates live

The core UX loop is: describe → grid mockup → confirm → generate → interact → refine → hand off.

**Two-step generation:** Before invoking the full planner pipeline (30-60s, Claude), the agent proposes a grid-based layout mockup directly in the chat (sub-2s, Groq). The mockup uses ASCII grid notation with `(rows×cols)` annotations that define the spatial contract. The user iterates on the grid cheaply, then confirms to trigger full Vizro generation. This prevents wasting expensive planner calls on layouts the user doesn't want, and produces a concrete grid spec that informs CSS/Tailwind generation for the handoff.

This change depends on `report-chat-tools` — without populated Report `columns_metadata`, the manifest would have no metrics or dimensions.

## What Changes

### Docker Compose
- Add `planner` service to `docker-compose.yml` with the Anthropic API key, health check endpoint, and appropriate profile (default or a new "dashboard" profile)
- Image built by Bazel or Dockerfile from `planner/`

### Grid Mockup Tool (Agent)
- New agent tool `proposeDashboardLayout` that generates a grid-based ASCII mockup from the semantic manifest and user prompt
- Grid annotations (`(rows×cols)`) become the spatial spec passed to the planner
- This runs via Groq (fast, cheap) — not the full LangGraph pipeline
- User confirms or refines the grid before full generation proceeds

### Manifest Generation (Backend)
- New use case: `generate_manifest` that reads a project's Views and Reports and produces a `SemanticManifest` JSON
- View columns map to data source definitions (dimension candidates based on `displayType`)
- Report `columns_metadata` (dimensions and measures) map to semantic metrics and dimensions
- New route: `GET /api/projects/{project_id}/manifest` returning the generated manifest

### Planner HTTP API
- Wrap the existing CLI `plan` command as a FastAPI or Hono HTTP endpoint
- Accept manifest JSON + grid spec + user prompt, return dashboard plan JSON
- Grid spec from the mockup step constrains the planner's layout decisions
- The `serve` command continues as CLI-only for local development

### Backend-Planner Bridge
- Backend proxies plan requests to the planner service (or frontend calls planner directly)
- `POST /api/projects/{project_id}/dashboards/plan` accepts a natural language prompt, generates manifest internally, calls planner, returns dashboard plan

## Capabilities

### New Capabilities
- `manifest-generation`: Backend use case that derives a `SemanticManifest` from project Views and Reports
- `planner-http-api`: HTTP endpoint wrapping the planner's CLI `plan` command

### Modified Capabilities
- `semantic-manifest-schema`: Auto-generation from Views/Reports rather than manual creation
- `planner-cli`: HTTP API surface alongside existing CLI
- `dashboard-plan-schema`: Consumed by the backend bridge, not just CLI

## Impact

- `docker-compose.yml` — new `planner` service definition
- `backend/app/use_cases/dashboard/generate_manifest.py` — new use case
- `backend/app/routers/dashboards.py` — new router with manifest and plan endpoints
- `planner/planner/api.py` — new HTTP API module (FastAPI)
- `planner/pyproject.toml` — add FastAPI/uvicorn dependencies if using HTTP API
- Tests: manifest generation tests, planner API integration tests
- No database migrations — manifest is generated on-the-fly, not persisted
