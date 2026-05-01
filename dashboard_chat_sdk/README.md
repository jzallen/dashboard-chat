# dashboard-chat-sdk

Typed Python SDK for the Dashboard Chat API.

> Status: **0.1.0 (alpha)** — surface limited to the headless-tokens guide flow.
> See [docs/guides/headless-tokens.md](../docs/guides/headless-tokens.md) for the
> equivalent `curl`-driven walkthrough.

## Why

`docs/guides/headless-tokens.md` shows partners how to drive Dashboard Chat with
`curl`. That works, but every partner re-implements the same request shapes and
JSON parsing, and schema changes only surface as runtime `KeyError`s. This SDK
generates typed Python from the FastAPI OpenAPI export plus the chat event
Pydantic models emitted by [H.1](../docs/decisions/adr-014-chatevent-vocabulary-stratification.md),
so schema drift becomes a type error.

## Install

```bash
pip install dashboard-chat-sdk            # once published
pip install -e ./dashboard_chat_sdk       # local checkout (during development)
```

## Surface

Initial scope is "everything the headless-tokens guide flow needs":

| Area                    | Endpoint(s)                              | Source service |
|-------------------------|------------------------------------------|----------------|
| PAT lifecycle           | `POST/GET/DELETE /api/auth/pats[/:id]`   | auth-proxy     |
| M2M client_credentials  | `POST /api/auth/token`                   | auth-proxy     |
| Project CRUD            | `POST/GET /api/projects[/:id]`           | backend        |
| Dataset CRUD            | `POST/GET/PATCH /api/datasets[/:id]`     | backend        |
| Chat turn (SSE consumer)| `POST /chat`                             | agent          |
| Session replay          | `GET /api/sessions/:id/events`           | backend        |

Out of scope for v0.1.0: admin endpoints, internal-only routes, auto-versioning
from schema diffs, TS SDK (tracked under H.3).

## Regenerating

The generated client lives under `src/dashboard_chat_sdk/_generated/`. To
refresh after a backend schema change:

```bash
./scripts/regenerate.sh
```

This:
1. dumps the FastAPI OpenAPI schema via `backend/scripts/export_openapi.py` into
   `dashboard_chat_sdk/openapi.json`, and
2. runs `openapi-python-client generate --path openapi.json` to regenerate
   `_generated/`.

The checked-in `openapi.json` is the source of truth at release time and lets
the SDK build without standing up the backend.

## Versioning

Semver, bound to the wire schema — not to the monorepo version. v0.1.0 ships
in this leaf; semver bumps are manual per release until auto-versioning lands.

## Smoke test

```bash
docker compose up -d
pip install -e ./dashboard_chat_sdk
python dashboard_chat_sdk/scripts/sdk-smoke-test.py
```

The smoke test covers PAT issuance, dataset upload, one chat turn, and replay,
mirroring the headless-tokens guide.
