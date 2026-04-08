# Planner Docker Integration: Connect Visual Design to the Data Platform

## Why

The layout planner (`planner/`) is a fully built multi-agent service that generates Vizro dashboard layouts from natural language prompts. It uses LangGraph with Anthropic Claude (Sonnet) and has a CLI (`plan`, `serve`), tests, and a complete agent pipeline (planner → section → filter → assembler → validation). ADR-011 documents the dual-LLM decision.

But the planner is an island — not in Docker Compose, no API surface for the main application, and critically, no way to generate a semantic manifest from the platform's Views and Reports. The product vision's Stage 4 (Visualize) requires the planner to receive a manifest describing available dimensions and measures, then produce dashboard layouts.

The integration path: users build Views and Reports through chat (Stages 1-2) → the backend generates a `SemanticManifest` from View columns and Report column metadata → the planner consumes the manifest and produces a dashboard plan → the Vizro renderer displays it.

This change depends on `report-chat-tools` — without populated Report `columns_metadata`, the manifest would have no metrics or dimensions.

## What Changes

### Docker Compose
- Add `planner` service to `docker-compose.yml` with the Anthropic API key, health check endpoint, and appropriate profile (default or a new "dashboard" profile)
- Image built by Bazel or Dockerfile from `planner/`

### Manifest Generation (Backend)
- New use case: `generate_manifest` that reads a project's Views and Reports and produces a `SemanticManifest` JSON
- View columns map to data source definitions (dimension candidates based on `displayType`)
- Report `columns_metadata` (dimensions and measures) map to semantic metrics and dimensions
- New route: `GET /api/projects/{project_id}/manifest` returning the generated manifest

### Planner HTTP API
- Wrap the existing CLI `plan` command as a FastAPI or Hono HTTP endpoint
- Accept manifest JSON + user prompt, return dashboard plan JSON
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
