# CLAUDE.md

## Project Overview

Dashboard Chat is a full-stack web application for chat-driven data table operations. Users control tables (filter, sort, add/delete rows) using natural language through an AI-powered interface.

## Architecture

Three services + shared code:
- **Frontend** (`frontend/`) — React 18 + Vite + TanStack Query/Table + Tailwind CSS
- **Backend** (`backend/`) — FastAPI + SQLAlchemy (async) + DuckDB + Alembic migrations
- **Worker** (`worker/`) — Hono (Node.js) chat API with SSE streaming via Groq
- **Shared** (`shared/chat/`) — Chat handler, prompts, and types used by both frontend and worker

## Monorepo Tooling

### npm Workspaces
The repo uses npm workspaces with three packages declared in the root `package.json`:
- `frontend` — React/Vite app
- `worker` — Hono chat API
- `shared/chat` — Shared chat handler, prompts, and types

Single `npm install` at root installs all workspace dependencies. Cross-workspace dependencies use `"dashboard-chat-shared": "*"` in each consumer's `package.json`. The root `package-lock.json` is the single lockfile.

### Turborepo
Task orchestration via `turbo.json`. Key commands:
```bash
npm run build              # turbo run build (frontend only — worker has no build step)
npm run test               # turbo run test:run (frontend + worker in parallel)
npm run test:all           # JS tests via turbo + backend via uv run pytest
```
- `build` tasks are cached by content hash; `test:run` and `dev` are never cached
- Backend is NOT in the turbo graph — it's a Python project managed separately

### Python Dependencies (uv + pyproject.toml)
Backend dependencies are managed exclusively through `backend/pyproject.toml` and locked in `backend/uv.lock`. There is no `requirements.txt`.

```bash
cd backend && uv sync              # install all deps (including dev group)
cd backend && uv run pytest        # run tests via uv
cd backend && uv add <package>     # add a new dependency
cd backend && uv lock              # regenerate lockfile after manual pyproject.toml edits
```

- **Runtime dependencies** go in `[project] dependencies`
- **Test/dev dependencies** (`pytest`, `pytest-xdist`, `moto`, etc.) go in `[dependency-groups] dev`
- `uv sync` installs the dev group by default; production builds use `uv sync --no-dev`
- Never create or update a `requirements.txt` — `pyproject.toml` is the single source of truth

## Getting Started

### Dev Container (recommended)
The `.devcontainer/` config installs Node 20, Python 3.11, and all dependencies automatically.

### Docker Compose
```bash
docker compose up                    # SQLite + MinIO + Redis (default)
docker compose up --profile full     # PostgreSQL instead of SQLite
```

### Services & Ports
| Service  | Port | URL                    |
|----------|------|------------------------|
| Frontend | 5173 | http://localhost:5173   |
| Backend  | 8000 | http://localhost:8000   |
| Worker   | 8787 | http://localhost:8787   |
| MinIO    | 9000 | http://localhost:9000   |
| Redis    | 6379 | localhost:6379          |

## Running Tests

### Frontend (Vitest + Testing Library + Happy DOM)
```bash
cd frontend && npx vitest run        # all tests
cd frontend && npx vitest run src/path/to/file.test.tsx  # single file
```

### Backend (pytest + pytest-asyncio + pytest-xdist)
```bash
cd backend && uv run pytest                              # all tests (parallel via xdist)
cd backend && uv run pytest tests/use_cases/dataset/     # directory
cd backend && uv run pytest tests/path/to/test.py -k test_name  # single test
cd backend && uv run pytest -n0                          # serial fallback (disable xdist)
```
- `asyncio_mode = "auto"` — no need for `@pytest.mark.asyncio`
- `addopts = "-n auto --dist=loadfile"` — parallel by default, grouped by file
- S3 is auto-mocked via moto (`mock_s3` fixture in conftest.py)

### Worker
```bash
npm run test:worker
```

### E2E (Playwright)
```bash
npm run test:e2e:local               # headless
npm run test:e2e:ui                  # interactive UI
```

## Key Conventions

### Backend Patterns

**Use cases** are individual modules in `app/use_cases/<domain>/` (e.g., `get_dataset.py`, `update_dataset.py`). Shared logic lives in service classes (e.g., `dataset_service.py`).

**Decorator stack** on use case functions:
```python
@with_repositories    # outer — injects RepositoryContainer, commits on success
@handle_returns       # inner — wraps result in Success/Failure
async def my_use_case(...):
```

**Error format**: `handle_returns` wraps exceptions as `Failure(e)` (the exception object itself). Tests should use `isinstance(result.failure(), SomeDomainException)` to assert on error type.

**Context vars**: `set_session(db)` and `set_auth_user(user)` must be called before invoking use cases in tests.

**Repository overrides in tests**:
```python
result = await some_use_case(..., repositories={'metadata_repository': MockRepo})
```

**Controllers** in `app/controllers/` delegate to use cases. Routes are in `app/routers/`.

### Frontend Patterns

**Data fetching**: TanStack Query with key factories (`projectKeys.detail(id)`, `datasetKeys.detail(id)`). Mutations use optimistic updates.

**Path aliases** (configured in vite.config.ts): `@/table-tools`, `@/chat`, `@/raqb`, `@/api`

**Tests** that render components using TanStack Query need a `QueryClientProvider` wrapper.

### Auth

Auth mode is controlled by `AUTH_MODE` env var (`"dev"` or `"workos"`).

- **Dev mode**: Uses hardcoded DEV_USER (id=`dev-user-001`, org_id=`dev-org-001`, token=`dev-token-static`)
- **WorkOS mode**: JWT verification against WorkOS JWKS
- **Middleware**: `AuthMiddleware` skips `/health`, `/`, `/docs`, `/auth/*`
- **Multi-tenancy**: Projects and datasets are scoped by `org_id`

### Database

- **Dev**: SQLite via aiosqlite (default)
- **Production**: PostgreSQL via asyncpg
- **Migrations**: Alembic in `backend/migrations/versions/`
- **Storage**: Parquet files in MinIO/S3, queried via DuckDB/Ibis

## MCP Servers

Two MCP servers are configured for this project:

- **Serena** — Semantic code intelligence toolkit. Provides symbol-level code navigation and editing (find_symbol, find_referencing_symbols, replace_symbol_body, insert_after_symbol, etc.) across 30+ languages. Prefer Serena's symbolic tools over reading entire files when exploring or editing code. Use `get_symbols_overview` to understand a file before diving into specific symbols with `find_symbol`.

- **Context7** — Up-to-date library documentation. Fetches version-specific docs and code examples directly into context. Use `resolve-library-id` to find a library, then `query-docs` to retrieve relevant documentation. Add "use context7" to prompts when working with external libraries (React, FastAPI, SQLAlchemy, TanStack Query, Hono, etc.) to avoid outdated APIs.

## Commit Convention

After completing work, always commit staged changes using **Conventional Commits** format. The stop hook runs tests and stages files automatically — you just need to commit.

- Run `git diff --cached` to see what's staged
- Write a commit message based on the actual diff (e.g., `feat(backend): add dataset pagination endpoint`)
- Use standard types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`
- Include scope in parentheses when changes are localized (e.g., `frontend`, `backend`, `worker`)
- No attributions (no "Co-authored-by", no "Generated by", etc.)
- Keep the subject line under 72 characters; add a body only if the change is non-obvious

## Code Style

- **TypeScript**: Strict mode, Prettier formatting
- **Python**: Black formatting, type hints throughout
- **Both**: Format on save in VS Code/devcontainer

## Project Structure

```
frontend/src/
  lib/
    api/          # API client (fetch wrapper with auth)
    auth/         # AuthProvider, useAuth hook
    ui/
      components/ # React components (AppShell, ChatPanel, TablePanel, etc.)
      hooks/      # Query hooks, table config, filter utils
      providers/  # QueryProvider
      context/    # ChatContext (SSE streaming)
    table-tools/  # Tool call execution, filter functions
    raqb/         # Query builder integration
  test/           # Test setup and helpers

backend/
  app/
    auth/         # Auth package (providers, middleware, context)
    models/       # SQLAlchemy ORM models
    repositories/ # Data access (metadata, lake/DuckDB, outbox)
    routers/      # FastAPI route handlers
    controllers/  # HTTP controllers
    use_cases/    # Business logic by domain
    config.py     # Settings from env vars
    database.py   # Async engine, session factory
    main.py       # App setup, middleware, router mounting
  migrations/     # Alembic migrations
  tests/          # Mirrors app/ structure

worker/
  index.ts        # Hono routes (chat, sessions, health)
  lib/
    auth.ts       # Auth middleware
    sessions/     # Session management (Redis + S3)
    s3.ts         # S3 client for audit logs

shared/chat/      # Chat handler, prompts, tool definitions
```
