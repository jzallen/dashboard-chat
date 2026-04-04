# CLAUDE.md

## Project Overview

Dashboard Chat — full-stack web app for chat-driven data table operations. Users control tables via natural language through an AI-powered interface.

## Architecture

- **Frontend** (`frontend/`) — React 18 + Vite + TanStack Query/Table + Tailwind CSS
- **Backend** (`backend/`) — FastAPI + SQLAlchemy (async) + DuckDB + Alembic migrations
- **Worker** (`worker/`) — Hono (Node.js) chat API with SSE streaming via Groq
- **Shared** (`shared/chat/`) — Chat handler, prompts, and types used by frontend + worker

## Editing Workflow

**Before editing any source file**, review and run its related tests first. Use the `tdd` skill to map source files to the correct Bazel test target. The workflow is:

1. Identify the test file(s) for the code you're about to change
2. Read the relevant tests to understand expected behavior
3. Run the targeted tests to confirm they pass (green baseline)
4. Make the edit
5. Re-run the same tests to confirm nothing broke
6. After all edits, run the full affected-service suite as a final check

This avoids wasting tokens on broken edits and catches regressions early.

## Quick Commands

```bash
npm run test:all                     # ALL tests: JS (turbo) + backend (pytest)
cd frontend && npx vitest run        # frontend only
cd backend && uv run pytest          # backend only
npm run test:worker                  # worker only
npm run build                        # turbo build (frontend only)
npm run dev                          # start all services
```

## Key Conventions

### Backend

- **Use cases**: individual modules in `app/use_cases/<domain>/` with decorator stack:
  ```python
  @handle_returns       # outer — Success/Failure wrapper
  @with_repositories    # inner — injects RepositoryContainer, auto-commits
  async def my_use_case(...):
  ```
- **Error format**: `Failure(e)` wraps exceptions; test with `isinstance(result.failure(), SomeDomainException)`
- **Context vars**: call `set_session(db)` and `set_auth_user(user)` before use cases in tests
- **Repository overrides**: `await some_use_case(..., repositories={'metadata_repository': MockRepo})`
- **Dependencies**: managed via `backend/pyproject.toml` + `uv.lock` (never `requirements.txt`)
- **DB**: SQLite (dev) / PostgreSQL (prod); migrations in `backend/migrations/versions/`

### Frontend

- **Data fetching**: TanStack Query with key factories (`projectKeys.detail(id)`)
- **Path aliases**: `@/table-tools`, `@/chat`, `@/raqb`, `@/api`
- **Tests**: need `QueryClientProvider` wrapper for components using TanStack Query

### Auth

- `AUTH_MODE`: `"dev"` (hardcoded DEV_USER) or `"workos"` (JWT via JWKS)
- Dev token: `dev-token-static`, user: `dev-user-001`, org: `dev-org-001`
- Multi-tenancy: projects/datasets scoped by `org_id`

## Commit Convention

Conventional Commits format.

- Types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`
- Include scope: `feat(backend): add dataset pagination endpoint`
- No attributions. Subject under 72 chars.

## Code Style

- **TypeScript**: strict mode, Prettier
- **Python**: Black, type hints throughout
