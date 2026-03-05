## Why

Pre-commit/pre-push hooks with Ruff and ESLint were just added to the monorepo but the codebase has never been linted. The first run found **294 Python errors** and **139 TypeScript warnings**, including 14 potential bugs (undefined names, lost exception context, unsafe `zip()`). These must be fixed before the hooks can enforce quality on new commits — otherwise every developer's first commit will fail.

## What Changes

### Python (Ruff) — 294 errors, 194 auto-fixable

**Auto-fixable (run `ruff check --fix` + `ruff format`):**
- `I001` (110): Unsorted imports across all modules
- `F401` (33 of 43): Unused imports in non-`__init__` files
- `UP017/UP035/UP037/UP041` (33): Legacy typing syntax → modern Python 3.11+ equivalents
- `RUF059/RUF022/RUF100/RUF010` (22): Ruff-specific cleanups (unused `__all__` sorting, dead `noqa` directives, explicit `str()` conversions)
- `SIM102/SIM117/SIM118` (10): Collapsible if/with blocks, `.keys()` removal
- `B011/B905/F541/W293` (10): Assert cleanup, `zip(strict=)`, f-string fixes, whitespace

**Manual fixes required:**
- `F401` (10): Unused imports in `__init__.py` re-exports — need `as` aliases for explicit re-export
- `F821` (5): **Undefined names** — `OutboxRecord`, `RestrictedSession`, `_get_dev_token` are referenced but not imported
- `B904` (4): **Lost exception context** — `raise` inside `except` without `from err` (auth providers, transform use case)
- `B008` (27): `Depends()` in argument defaults — **false positive for FastAPI**, needs rule suppression
- `E501` (17): Lines >120 chars — manual reformatting
- `E402` (6): Module-level imports not at top of file
- `UP007` (2): `Optional[X]` → `X | None` in type annotations
- Others (7): `SIM105`, `SIM116`, `RUF012`, `F841`, `B017` — one-off fixes

### TypeScript (ESLint) — 139 warnings, 0 errors, 102 auto-fixable

**Auto-fixable (run `eslint --fix`):**
- `simple-import-sort/imports` (96): Import ordering across all TS/TSX files
- `simple-import-sort/exports` (6): Export ordering

**Manual fixes required:**
- `testing-library/no-unnecessary-act` (16): Unnecessary `act()` wrappers in test files
- `no-console` (7): `console.log` calls in worker — should be `console.debug` or removed
- `@typescript-eslint/no-explicit-any` (6): Untyped `any` in production source
- `react-refresh/only-export-components` (3): Non-component exports from component files
- `react-hooks/exhaustive-deps` (3): Missing dependencies in useEffect/useMemo/useCallback
- `@typescript-eslint/no-unused-vars` (2): Dead variables

### Rule Suppression Needed

- `B008`: FastAPI's `Depends()` pattern is idiomatic — add `# noqa: B008` or add to ruff ignore list for router files

## Capabilities

### New Capabilities

- `code-quality-baseline`: Specification of lint rules, formatting standards, and the auto-fix vs. manual-fix boundary for both Python and TypeScript codebases

### Modified Capabilities

_(none — no existing specs are affected by lint fixes)_

## Impact

- **Backend** (`backend/app/`, `backend/tests/`): 294 fixes across ~60 Python files. Most are formatting/import changes. The F821 (undefined name) and B904 (exception chaining) fixes change runtime behavior slightly.
- **Frontend** (`frontend/src/`): ~120 fixes across ~40 TS/TSX files. Import reordering and test cleanup.
- **Worker** (`worker/`): ~19 fixes across ~8 TS files. Import reordering and console.log cleanup.
- **Shared** (`shared/chat/`): ~3 fixes. Import reordering only.
- **No API changes**: All fixes are internal code quality — no endpoint signatures, schemas, or behaviors change.
- **No dependency changes**: Tools (ruff, eslint) are already installed from the hooks implementation.
- **Tests**: `react-hooks/exhaustive-deps` fixes could change component behavior if dependency arrays are updated — these need careful review. All other fixes are safe.
