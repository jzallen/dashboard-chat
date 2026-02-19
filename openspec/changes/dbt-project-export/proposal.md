## Why

Users build data transformation pipelines inside Dashboard Chat — filtering rows, cleaning columns, mapping values, renaming headers — all through natural language. But those transformations are locked inside the app. When users need to run the same logic in CI/CD pipelines, scheduled jobs, or hand it off to a data engineering team, they have no export path. Adding a dbt project export lets users take their work out of the dashboard as a standard dbt project zip file, bridging the gap between interactive exploration and production data workflows.

## What Changes

- **Add a dbt project export use case** (`export_dbt_project`) that reads a project's datasets and transforms, generates dbt-compatible YAML and SQL files, packages them as an in-memory zip, and returns the binary response
- **Add a dbt file generator module** (`backend/app/use_cases/project/dbt/`) containing purpose-built generators for `dbt_project.yml`, `profiles.yml`, `sources.yml`, `schema.yml`, per-dataset staging model SQL, a README, and a naming utility for snake_case deduplication
- **Add a new API endpoint** (`GET /api/projects/{project_id}/export/dbt`) that returns a `StreamingResponse` with `application/zip` content type and a `Content-Disposition` header — the first binary response endpoint in the codebase
- **Add a frontend download function** and UI trigger (button/menu item) for initiating the export with auth headers and handling the browser download via blob URL
- **Generate purpose-built dbt SQL** for each dataset using CTE chains with `{{ source() }}` macro references, human-readable cleaning/filter/alias stages — distinct from the Ibis-compiled SQL used for live execution

## Capabilities

### New Capabilities
- `dbt-project-generation`: Backend module that converts a project's metadata, datasets, schemas, and transforms into a complete dbt project file structure (YAML config files, staging model SQL, README) packaged as a zip archive
- `dbt-export-api`: HTTP endpoint for authenticated project export, binary response handling via StreamingResponse, frontend download trigger with blob-based browser download

### Modified Capabilities
<!-- No existing specs to modify — openspec/specs/ is currently empty -->

## Impact

- **Backend use case layer**: New use case module at `app/use_cases/project/export_dbt_project.py` following existing `@with_repositories` + `@handle_returns` pattern; new `dbt/` generator package under `app/use_cases/project/`
- **Backend API surface**: One new endpoint (`GET /api/projects/{project_id}/export/dbt`) in `app/routers/projects.py`; introduces `StreamingResponse` pattern (no existing binary response precedent)
- **Backend route pattern**: Route handler calls use case directly and returns `StreamingResponse` for success / `JSONResponse` for errors — the controller's `tuple[dict, int]` pattern does not support binary responses
- **Frontend API layer**: New download function in `frontend/src/lib/api/` using `fetch` + `blob()` + programmatic anchor click for browser download
- **Frontend UI**: Minimal "Export as dbt" button in project view
- **Dependencies**: May need PyYAML (check if already in deps); no new npm packages, no new infrastructure, no database migration (reads existing data only)
- **No worker or shared chat changes**: This is a pure backend + thin frontend feature
