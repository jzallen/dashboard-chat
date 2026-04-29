# CLAUDE.md

## Project Overview

Dashboard Chat — full-stack web app for chat-driven data table operations. Users control tables via natural language through an AI-powered interface.

## Architecture

- **Frontend** (`frontend/`) — React 18 + Vite + TanStack Query/Table + Tailwind CSS
- **Backend** (`backend/`) — FastAPI + SQLAlchemy (async) + DuckDB + Alembic migrations
- **Worker** (`worker/`) — Hono (Node.js) chat API with SSE streaming via Groq
- **Shared** (`shared/chat/`) — Single source of truth for the chat event schema (`@dashboard-chat/shared-chat`); imported by both `agent/` and `frontend/`. Future cross-cutting chat types/handlers/prompts go here.

## Development Methodology — nwave-ai waves

This project uses **nwave-ai** as its SDLC framework (see [ADR-013](docs/decisions/adr-013-nwave-adoption.md)). Features flow through waves.

**This is a brownfield codebase — enter at later waves.** ADRs 001–012 already ratify most of the architecture, so new features start at **DISCUSS** (not DIVERGE or DISCOVER), refactors start at **DESIGN** or **DELIVER**, and bug fixes with known cause start at **DISTILL**. See [docs/research/nwave-brownfield-approach.md](docs/research/nwave-brownfield-approach.md) for the full routing matrix and rationale.

**Pick the right entry point by task shape:**

| Task shape | Entry command | Produces |
|---|---|---|
| New feature (stories already exist or obvious) | `/nw-discuss` | Stories + Given-When-Then AC + UX journeys |
| Architecture question or refactoring scope | `/nw-design` | C4 + ADRs + domain model |
| Have stories, need tests | `/nw-distill` | BDD acceptance tests + `roadmap.json` |
| Ready to build (tests already green) | `/nw-deliver` | Working code via Outside-In TDD |
| Bug report, cause known | `/nw-distill` first (write regression test) | Regression test + fix |
| Bug report, cause unknown | `/nw-bugfix` (→ `/nw-root-why`) | RCA → regression test → fix |
| Code quality / churn / tech debt | `/nw-hotspot` then `/nw-refactor` | Hotspot map → RPP L1–L6 passes |
| Complex multi-module refactor | `/nw-mikado` | Mikado roadmap with visual tracking |
| Legacy code needing DDD extraction | `nw-legacy-refactoring-ddd` skill via `/nw-refactor` | Characterization tests + bounded-context extraction |
| Root cause of failure (no fix yet) | `/nw-root-why` | 5-Whys analysis |
| Documentation | `/nw-document` | DIVIO/Diátaxis-compliant docs |
| Unsure where to start | `/nw-new` or `/nw-continue` | Wizard picks the wave |

**Iron Rule & pre-existing theater tests:** NEVER modify a failing test to make it pass. For pre-existing bad tests (tautological, assertion-free, implementation-mirroring, etc.), triage via `nw-test-refactoring-catalog` L1–L3 before deleting or rewriting. Before touching untested legacy code, write **characterization tests** (Feathers) first — they are the brownfield analog to the walking skeleton.

**Feature artifacts live in `docs/feature/{slug}/`** during active waves and migrate to `docs/evolution/` on `/nw-finalize`. The slug is a kebab-case description of the feature (e.g. `log-image-identity-on-startup`); bead linkage stays via git trailers and bead descriptions, not directory names.

**Testing discipline — Outside-In TDD + hexagonal:**
- Write/update the acceptance test first (RED_ACCEPTANCE).
- Drive a unit test from the smallest failing step (RED_UNIT).
- Make it green with minimum code.
- Refactor after GREEN per RPP L1–L6.
- **Iron Rule**: NEVER modify a failing test to make it pass. After 3 failed attempts, revert and escalate.
- Mocks only at port boundaries. No internal class mocks.

**Running tests during development** (use the `tdd` skill to map source → test target):

```bash
npm run test:all                     # ALL tests: JS (turbo) + backend (pytest)
cd frontend && npx vitest run        # frontend only
cd backend && uv run pytest          # backend only
npm run test:worker                  # worker only
```

**Gates:**
- Pre-commit runs ruff + eslint auto-fix (fast; preserved).
- Pre-push Bazel gate removed — Bazel runs in CI only.
- nwave's DES hooks enforce Outside-In TDD discipline at agent level (11 quality gates under `standard` rigor).

## Quick Commands

```bash
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

- **Style**: Conventional Commits — `type(scope): subject`
- **Types**: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`
- **Scope**: include where it adds clarity, e.g. `feat(backend): add dataset pagination endpoint`
- **Subject**: under 72 chars
- **Attribution**: do not attribute Claude (no `Co-Authored-By` lines or "generated with" footers)
- **Base the message on the diff** — describe what changed and why it matters, not the process used to arrive at it
- **Atomic commits**: if multiple logical changes exist, prefer separate atomic commits over one combined commit

## Code Style

- **TypeScript**: strict mode, Prettier
- **Python**: Black, type hints throughout
