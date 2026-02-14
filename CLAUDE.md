# CLAUDE.md

## Project Overview

Dashboard Chat is a full-stack web application for chat-driven data table operations. Users control tables (filter, sort, add/delete rows) using natural language through an AI-powered interface.

## Architecture

Three services + shared code:
- **Frontend** (`frontend/`) — React 18 + Vite + TanStack Query/Table + Tailwind CSS
- **Backend** (`backend/`) — FastAPI + SQLAlchemy (async) + DuckDB + Alembic migrations
- **Worker** (`worker/`) — Hono (Node.js) chat API with SSE streaming via Groq
- **Shared** (`shared/chat/`) — Chat handler, prompts, and types used by both frontend and worker

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

### Backend (pytest + pytest-asyncio)
```bash
cd backend && python -m pytest       # all tests
cd backend && python -m pytest tests/use_cases/dataset/  # directory
cd backend && python -m pytest tests/path/to/test.py -k test_name  # single test
```
- `asyncio_mode = "auto"` — no need for `@pytest.mark.asyncio`
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

**Error format**: `handle_returns` produces `f"[{func.__name__}] {str(e)}"` — tests must match this pattern.

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
