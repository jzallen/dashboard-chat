## ADDED Requirements

### Requirement: Python source passes ruff check with zero errors
All Python source files in `backend/` SHALL pass `ruff check .` with zero errors using the rule set configured in `pyproject.toml` (`F`, `E`, `W`, `I`, `B`, `UP`, `SIM`, `RUF`).

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
All Python source files in `backend/` SHALL pass `ruff format --check .` with zero reformatting needed, using the line-length and target-version configured in `pyproject.toml`.

#### Scenario: Clean ruff format check on backend source
- **WHEN** `cd backend && uv run ruff format --check .` is executed
- **THEN** the command exits with code 0 and reports no files needing reformatting

### Requirement: TypeScript source passes ESLint with zero warnings
All TypeScript and TSX files in `frontend/`, `worker/`, and `shared/` SHALL pass `eslint .` with zero errors and zero warnings using the rules configured in `eslint.config.js`.

#### Scenario: Clean ESLint check on all TypeScript source
- **WHEN** `npx eslint .` is executed from the project root
- **THEN** the command exits with code 0 and reports zero problems

#### Scenario: Import ordering is consistent
- **WHEN** any `.ts` or `.tsx` file is checked by ESLint
- **THEN** imports SHALL be sorted by the `simple-import-sort` plugin rules (external packages first, then internal aliases, then relative imports)

### Requirement: Undefined Python name references are resolved
All F821 (undefined name) violations SHALL be resolved by adding the correct import statement, not by removing the reference.

#### Scenario: OutboxRecord is importable in upload model
- **WHEN** `app/models/upload.py` references `OutboxRecord`
- **THEN** the symbol SHALL be imported from its defining module and ruff F821 SHALL not be raised

#### Scenario: RestrictedSession is importable in repository files
- **WHEN** `app/repositories/external_access.py`, `app/repositories/metadata/repository.py`, or `app/repositories/outbox/repository.py` references `RestrictedSession`
- **THEN** the symbol SHALL be imported from its defining module and ruff F821 SHALL not be raised

#### Scenario: Test helpers are importable in integration tests
- **WHEN** `tests/integration/test_api.py` references `_get_dev_token`
- **THEN** the symbol SHALL be imported or defined locally and ruff F821 SHALL not be raised

### Requirement: Exception chaining preserves context
All `raise` statements inside `except` blocks SHALL use `from err` or `from None` to preserve or explicitly discard the exception chain (B904).

#### Scenario: Auth provider re-raises with context
- **WHEN** `dev_provider.py` or `workos_provider.py` catches an exception and raises a new `AuthenticationError`
- **THEN** the raise SHALL include `from err` to preserve the original traceback

#### Scenario: Transform use case re-raises with context
- **WHEN** `app/use_cases/transform.py` catches an exception and raises a new error
- **THEN** the raise SHALL include `from err` to preserve the original traceback

### Requirement: React hook dependencies are correct or explicitly suppressed
All `react-hooks/exhaustive-deps` warnings SHALL be resolved by either adding the missing dependency or suppressing with an inline `// eslint-disable-next-line` comment that includes a rationale.

#### Scenario: Missing dependency is safe to add
- **WHEN** a `useEffect`, `useMemo`, or `useCallback` is missing a dependency that is stable (e.g., dispatch, ref)
- **THEN** the dependency SHALL be added to the dependency array

#### Scenario: Missing dependency would cause infinite re-renders
- **WHEN** adding a dependency would create a render loop (e.g., the dependency is an object created during render)
- **THEN** the warning SHALL be suppressed with `// eslint-disable-next-line react-hooks/exhaustive-deps -- <reason>`

### Requirement: Console statements use appropriate log levels
All `console.log` calls in production source files SHALL be replaced with `console.debug`, `console.warn`, or `console.error` as appropriate for the message severity. The `no-console` ESLint rule allows `warn`, `error`, and `debug`.

#### Scenario: Worker debug output uses console.debug
- **WHEN** a worker source file logs informational messages
- **THEN** it SHALL use `console.debug()` instead of `console.log()`

#### Scenario: Error conditions use console.error
- **WHEN** a source file logs an error condition
- **THEN** it SHALL use `console.error()` instead of `console.log()`

### Requirement: Test files suppress act() warnings with inline comments
All `testing-library/no-unnecessary-act` warnings in frontend test files SHALL be suppressed with inline `// eslint-disable-next-line` comments until the frontend test suite is fully operational.

#### Scenario: act() wrapper in a test file
- **WHEN** a test file in `frontend/src/test/` wraps operations in `act()`
- **THEN** the line above SHALL include `// eslint-disable-next-line testing-library/no-unnecessary-act` to suppress the warning

### Requirement: Pre-commit hook passes on clean codebase
After all lint fixes are applied, the pre-commit hook SHALL pass when staging any file in the repository.

#### Scenario: Committing a backend Python file
- **WHEN** a developer stages a Python file in `backend/` and runs the pre-commit hook
- **THEN** lint-staged SHALL run `ruff check --fix` and `ruff format` successfully with exit code 0

#### Scenario: Committing a frontend TypeScript file
- **WHEN** a developer stages a `.ts` or `.tsx` file and runs the pre-commit hook
- **THEN** lint-staged SHALL run `eslint --fix` successfully with exit code 0
