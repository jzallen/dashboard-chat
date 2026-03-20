## MODIFIED Requirements

### Requirement: TypeScript source passes ESLint with zero warnings
All TypeScript and TSX files in `frontend/`, `worker/`, and `shared/` SHALL pass `eslint .` with zero errors and zero warnings using the rules configured in `eslint.config.js`. The canonical CI invocation is `bazel test //frontend:lint //worker:lint`; the npm script `npx eslint .` remains available for local convenience.

#### Scenario: Clean ESLint check via Bazel lint targets
- **WHEN** `bazel test //frontend:lint //worker:lint` is executed
- **THEN** both targets exit with code 0 and Bazel reports them as PASSED

#### Scenario: Clean ESLint check on all TypeScript source
- **WHEN** `npx eslint .` is executed from the project root
- **THEN** the command exits with code 0 and reports zero problems

#### Scenario: Import ordering is consistent
- **WHEN** any `.ts` or `.tsx` file is checked by ESLint
- **THEN** imports SHALL be sorted by the `simple-import-sort` plugin rules (external packages first, then internal aliases, then relative imports)

### Requirement: Python source passes ruff check with zero errors
All Python source files in `backend/` SHALL pass `ruff check .` with zero errors using the rule set configured in `pyproject.toml` (`F`, `E`, `W`, `I`, `B`, `UP`, `SIM`, `RUF`). The canonical CI invocation is `bazel test //backend:lint`; the uv command `uv run ruff check .` remains available for local convenience.

#### Scenario: Clean ruff check via Bazel lint target
- **WHEN** `bazel test //backend:lint` is executed
- **THEN** the target exits with code 0 and Bazel reports it as PASSED

#### Scenario: Clean ruff check on backend source
- **WHEN** `cd backend && uv run ruff check .` is executed
- **THEN** the command exits with code 0 and produces no error output

#### Scenario: FastAPI Depends() pattern is not flagged
- **WHEN** a router file in `app/routers/` uses `Depends()` in function parameter defaults
- **THEN** ruff SHALL NOT report B008 violations for that file, because `app/routers/*` is excluded from B008 via per-file-ignores

#### Scenario: Package re-exports use explicit aliases
- **WHEN** an `__init__.py` file re-exports symbols for public use (e.g., `from .context import get_auth_user`)
- **THEN** the import SHALL use the explicit re-export form (`from .context import get_auth_user as get_auth_user`) so ruff F401 does not flag it as unused

### Requirement: Python source passes ruff format check
All Python source files in `backend/` SHALL pass `ruff format --check .` with zero reformatting needed. The canonical CI invocation is `bazel test //backend:lint` (which runs both ruff check and ruff format --check); the uv command remains available for local use.

#### Scenario: Clean ruff format check via Bazel lint target
- **WHEN** `bazel test //backend:lint` is executed
- **THEN** the target exits with code 0, confirming both ruff check and format check pass

#### Scenario: Clean ruff format check on backend source
- **WHEN** `cd backend && uv run ruff format --check .` is executed
- **THEN** the command exits with code 0 and reports no files needing reformatting

### Requirement: Pre-commit hook passes on clean codebase
After all lint fixes are applied, the pre-commit hook SHALL pass when staging any file in the repository. The hook runs auto-fixers across all tracked files and re-stages changes — it does not use lint-staged (replacing the pre-commit hook is a Non-Goal of this change; see design.md).

#### Scenario: Committing a backend Python file
- **WHEN** a developer stages a Python file in `backend/` and runs the pre-commit hook
- **THEN** the hook SHALL run `uv run ruff format .` and `uv run ruff check --fix .` successfully, re-stage modified files via `git add -u`, and exit with code 0

#### Scenario: Committing a frontend TypeScript file
- **WHEN** a developer stages a `.ts` or `.tsx` file and runs the pre-commit hook
- **THEN** the hook SHALL run `npx eslint --fix .`, re-stage modified files via `git add -u`, and exit with code 0
