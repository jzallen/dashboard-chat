# CLAUDE.md

## Project Overview

Dashboard Chat — full-stack web app for chat-driven data table operations. Users control tables via natural language through an AI-powered interface.

## Architecture

Source-tree directories are named for the **body of source they contain**. Docker-compose service names are named for the **runtime role of the container**. The two layers are decoupled (ADR-033). When they differ, the divergence is intentional and the source-tree name is the canonical reference.

- **Frontend** (`frontend/`) — React 18 + React Router v7 source tree. RRv7 framework mode lives under `frontend/app/` (`root.tsx` + `routes.ts` + `lib/` + `routes/`) per ADR-034; the SPA hydration entry is `frontend/main.tsx` mounting `<HydratedRouter />`. The same source body produces TWO compose-service-bound OCI images via `frontend/BUILD.bazel`: (1) **`reverse-proxy`** — nginx serving `dist/client/` static + routing `/api/*`, `/worker/*`, `/api/channels/:id/presentation-state`, `/health`, `/assets/*`, and proxying all other paths to (2) **`web-ssr`** — Hono container hosting the RRv7 SSR request handler. Source-tree / compose-topology separation per ADR-033 + ADR-034; `ui-presentation/` was dissolved at MR-0 and its scaffolds migrated into `frontend/app/routes/` (DWD-4).
- **UI-State** (`ui-state/`) — Hono + XState v5 actor system holding flow state across machines (ADR-027/028/030). Architecturally a **backend-for-frontend service** (Hono + Redis), sibling of `agent/` and `auth-proxy/`; named for its consumer surface rather than its layer. Redis key prefix `ui-state:`.
- **Backend** (`backend/`) — FastAPI + SQLAlchemy (async) + DuckDB + Alembic migrations
- **Agent** (`agent/`) — Hono (Node.js) chat API with SSE streaming via Groq
- **Auth-Proxy** (`auth-proxy/`) — Hono ingress: JWT verification, M2M token mint, identity-header injection, multi-upstream routing
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
cd frontend && npx vitest run        # frontend (SPA) only
cd backend && uv run pytest          # backend only
npm run test:agent                   # agent only
```

Acceptance suites (per-feature, run separately from the standard test commands):

```bash
# Each suite lives at tests/acceptance/<feature>/ with its own pyproject.toml + venv.
# Run from inside the suite directory; the --no-project flag skips the workspace
# uv would otherwise infer from cwd.
cd tests/acceptance/<feature> && uv run --no-project pytest
```

**Workflow — trunk-based development via the merge queue.** Every change lands on `main` through the gastown headless merge queue (rig: `dashboard_chat`). `gt mq submit` is the single entry point; the refinery rebases the source branch onto latest `main`, runs the gate (`./tools/test/test.sh --auto`), and merges on green. The `--auto` selector is content-aware — docs-only diffs (matching `docs/**`, `.claude/skills/**`, `.claude/settings.json`, `README*`, `CHANGELOG*`, `*.md`) skip the backend tests; any code touch falls through to `--backend` (ruff + pytest). The dispatcher script (`tools/test/test.sh`) supports `--backend`, `--ui`, `--agent`, `--all`, `--integration`, `--acceptance=<feature>`, `--auto` selectors. Acceptance suites run locally by the agent or human before submission — not in the queue.

**No upstream GitHub PRs as a primary mechanism.** Feature branches are short-lived and land via `gt mq submit`; "PR" vocabulary in older ADRs (e.g. ADR-031) refers to merge requests, not GitHub Pull Requests. Use "MR-N" (merge request) when sequencing planned landings — matches ADR-026 + gt mq vocabulary. GitHub PRs are reserved for exceptional cases where a human-driven review is genuinely needed (rare); not part of the routine workflow.

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
- M2M (service-to-service): auth-proxy mints OAuth2 `client_credentials`
  tokens at `POST /api/auth/token` (flag-gated by `M2M_ENABLED=true`). In
  `AUTH_MODE=dev` a built-in `dev-m2m-client` / `dev-m2m-secret` mints
  tokens that resolve to `DEV_USER` — see
  [auth-proxy/README.md](auth-proxy/README.md) for the env vars,
  production setup, and token flow.
- Headless flow (PATs + M2M, dev/prod curl examples): see
  [docs/guides/headless-tokens.md](docs/guides/headless-tokens.md).
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

### Docstrings over comment diaries

- Prefer well-formatted docstrings on **modules, classes, and functions** to explain
  intent, behavior, and contracts. Reach for a docstring first; reach for an inline
  comment only for a genuinely non-obvious local detail.
- Do **not** narrate code with a running diary of inline comments. Let the code (and
  for tests, the assertions) carry the meaning. In tests especially, the test *is* the
  spec — drop step-by-step `# Behavior N:` style comments.
- Module/file-level docstrings may carry an **agent section** for agent process rules,
  delimited by a line like `IF YOU'RE AN AGENT, READ THIS:`. Keep it short and use it
  for rules (e.g. "tests are the spec — don't weaken assertions"), never for running
  commentary. Human-facing description goes above it.

## Domain Modeling (TS: `type` / `interface` / `class` / Zod)

When modeling a concept, the **hexagonal layer** + the **DDD building block** pick the
tool — see the [`domain-modeling`](.claude/skills/domain-modeling/SKILL.md) skill.
In short: **classes** for the domain core (entities, aggregates, value objects with
behavior, domain services) and the **interfaces** it owns (repository ports); **branded
`type`** for validated primitives; **`type`/`interface`** for application
commands/queries and boundary DTOs (`z.infer` when derived from a schema); **Zod**
only at the inbound adapter boundary to validate untrusted input. Dependencies point
inward — no Zod/ORM/HTTP in the domain; don't put a `class` on the wire; no `I`-prefix
interfaces or first-party `.d.ts` for domain types.
