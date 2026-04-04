# CLAUDE_REFERENCE.md

Extended reference material for Claude Code. This file is NOT injected into every turn — read it on demand when needed.

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

### Bazel (Hermetic Builds)
Bazel 9.0.0 is available as an alternative build system for hermetic, reproducible builds and OCI image creation. Existing npm/uv commands still work for interactive dev.

```bash
bazel build //...                                # build everything
bazel test //...                                 # run all tests (backend + frontend + worker)
bazel test //backend:tests                       # all backend tests (15 targets in parallel)
bazel test //backend:test_auth                   # single backend test target
bazel test //frontend:test                       # all 8 frontend test suites
bazel test //frontend:test_core_auth             # single frontend module
bazel test //frontend:test_ui_components         # UI component tests only
bazel test //worker:test                         # worker tests only
bazel build //:images                            # build all 4 OCI images (frontend, backend, agent, auth-proxy)
bazel test //e2e:e2e --config=e2e                # e2e tests (requires Docker)
```

- Bazel config is in `MODULE.bazel` (bzlmod deps), `.bazelrc` (flags), and per-service `BUILD.bazel` files
- Frontend has 8 per-module `vitest_test` targets (test_lib, test_core_auth, test_core_chat, test_core_datacatalog, test_core_toolcalls, test_ui_hooks, test_ui_context, test_ui_components) grouped under `//frontend:test`. Each target has scoped source deps for per-module cache invalidation.
- JS tests use `vitest_test` from `@npm//:vitest/package_json.bzl` (sandboxed, no `no-sandbox` tag)
- Backend uses layered `py_library` targets (core → models/utils → plugins/repos → auth → use_cases → controllers → app) and a `pytest_tests` macro in `backend/pytest_tests.bzl` that generates one `py_test` per test file
- Backend has 15 test suites (one per directory) + `test_fitness` (tagged `manual`), all grouped under `//backend:tests`
- Individual test files can be run as `bazel test //backend:test_utils_tests_utils_test_pagination` (pattern: `<suite>_<path_underscored>`)
- OCI images use `oci_load` (rules_oci v2.2.7) — loader scripts in `bazel-bin/`
- Disk cache at `~/.cache/bazel-disk` (configured in `.bazelrc`)

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
make up                              # Build Bazel OCI images + load + compose up (recommended)
make up-full                         # Same, with full profile (PostgreSQL + hot-reload)
make up-force                        # Force-recreate all containers
make down                            # Stop all services
docker compose up                    # Manual: works if images are pre-loaded
```
Bazel-built services use `pull_policy: never` — if images aren't loaded, compose fails loudly instead of pulling stale/nonexistent tags.

### Services & Ports
| Service  | Port | URL                    |
|----------|------|------------------------|
| Frontend | 5173 | http://localhost:5173   |
| Backend  | 8000 | http://localhost:8000   |
| Worker   | 8787 | http://localhost:8787   |
| MinIO    | 9000 | http://localhost:9000   |
| Redis    | 6379 | localhost:6379          |

## Testing Details

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

## MCP Servers

Two MCP servers are configured for this project:

- **Serena** — Semantic code intelligence toolkit. Provides symbol-level code navigation and editing (find_symbol, find_referencing_symbols, replace_symbol_body, insert_after_symbol, etc.) across 30+ languages. Prefer Serena's symbolic tools over reading entire files when exploring or editing code. Use `get_symbols_overview` to understand a file before diving into specific symbols with `find_symbol`.

- **Context7** — Up-to-date library documentation. Fetches version-specific docs and code examples directly into context. Use `resolve-library-id` to find a library, then `query-docs` to retrieve relevant documentation. Add "use context7" to prompts when working with external libraries (React, FastAPI, SQLAlchemy, TanStack Query, Hono, etc.) to avoid outdated APIs.

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
