# dashboard-chat-sdk

Typed Python SDK for the Dashboard Chat API — FastAPI surface only in v0.1.0.

> Status: **0.1.0 (alpha)** — covers project, dataset, session, and replay
> endpoints. PAT/M2M minting (auth-proxy) and the chat SSE consumer (agent)
> are out of scope for this release; they ship as a unified client in a
> follow-on once H.4 (auth-proxy → OpenAPI) and H.5 (agent → OpenAPI) land.

## Why

`docs/guides/headless-tokens.md` shows partners how to drive Dashboard Chat
with `curl`. That works, but every partner re-implements the same request
shapes and JSON parsing, and schema changes only surface as runtime
`KeyError`s. This SDK is generated from the FastAPI OpenAPI export so schema
drift becomes a type error.

## Install

```bash
pip install dashboard-chat-sdk            # once published
pip install -e ./dashboard_chat_sdk       # local checkout (during development)
```

## Usage

```python
from dashboard_chat_sdk import Client
from dashboard_chat_sdk._generated.api.projects import (
    create_project_api_projects_post,
    list_projects_api_projects_get,
)
from dashboard_chat_sdk._generated.models.project_create import ProjectCreate

with Client(token="dev-token-static") as c:
    create_project_api_projects_post.sync(
        client=c.raw,
        body=ProjectCreate(name="my-project"),
    )
    listing = list_projects_api_projects_get.sync(client=c.raw)
```

`c.raw` is the underlying `AuthenticatedClient` — every endpoint generated
from the OpenAPI schema is reachable through the `_generated.api.*` modules.
The `Client` wrapper exists to pin the public constructor surface across
codegen churn.

PAT or M2M tokens work the same way once you have one — see
[docs/guides/headless-tokens.md](../docs/guides/headless-tokens.md) for how
to mint them via `curl` until the SDK covers that path.

## Surface (v0.1.0)

| Area                    | Endpoint(s)                              | In v0.1.0?               |
|-------------------------|------------------------------------------|--------------------------|
| Project CRUD            | `POST/GET/PATCH /api/projects[/:id]`     | ✓                        |
| Dataset CRUD            | `POST/GET/PATCH /api/datasets[/:id]`     | ✓                        |
| Upload + transforms     | `POST /api/uploads`, `/api/datasets/:id/transforms` | ✓             |
| Session lifecycle       | `POST/GET/PATCH /api/projects/:id/sessions` | ✓                     |
| Session replay          | `GET /api/sessions/:id/events`           | ✓                        |
| PAT lifecycle           | `POST/GET/DELETE /api/auth/pats[/:id]`   | — H.4 (auth-proxy emits OpenAPI) |
| M2M client_credentials  | `POST /api/auth/token`                   | — H.4 (auth-proxy emits OpenAPI) |
| Chat turn (SSE)         | `POST /chat`                             | — H.5 (agent emits OpenAPI)      |

Out of scope for v0.1.0 entirely: admin endpoints, internal-only routes,
auto-versioning from schema diffs, TS SDK (tracked under H.3).

## Regenerating

The generated client lives under `src/dashboard_chat_sdk/_generated/`. To
refresh after a backend schema change:

```bash
./scripts/regenerate.sh
```

This:
1. dumps the FastAPI OpenAPI schema via `backend/scripts/export_openapi.py`
   into `dashboard_chat_sdk/openapi.json`, and
2. runs `openapi-python-client@0.28.3` (via `uvx`) to regenerate
   `_generated/`.

The checked-in `openapi.json` is the source of truth at release time and
lets the SDK build without standing up the backend.

## Versioning

Semver, bound to the wire schema — not to the monorepo version. v0.1.0
ships in this leaf; semver bumps are manual per release until
auto-versioning lands.

## Testing

Unit tests (no backend required):

```bash
cd dashboard_chat_sdk
uv venv .venv && uv pip install --python .venv/bin/python -e ".[dev]"
.venv/bin/pytest
```

Compose-runnable smoke test (mirrors the headless-tokens guide):

```bash
docker compose up -d
pip install -e ./dashboard_chat_sdk
python dashboard_chat_sdk/scripts/sdk-smoke-test.py
```
