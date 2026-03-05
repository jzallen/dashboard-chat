## Context

Pre-commit/pre-push hooks with Ruff (Python) and ESLint (TypeScript) were added to the monorepo. The codebase has never been linted, so the first run surfaces 294 Python errors and 139 TypeScript warnings. These need to be resolved so the hooks can enforce quality going forward. The fixes are purely internal — no APIs, schemas, or user-facing behavior changes.

The codebase follows established patterns: FastAPI `Depends()` in routers, `__init__.py` re-exports for packages, `@with_repositories` / `@handle_returns` decorator stacks, and TanStack Query hooks with complex dependency arrays.

## Goals / Non-Goals

**Goals:**
- Reach zero lint errors/warnings so pre-commit hooks pass cleanly
- Fix actual bugs found by linting (undefined names, lost exception context)
- Suppress false positives with targeted, documented rule ignores
- Preserve all existing test behavior — no test should break from lint fixes

**Non-Goals:**
- Refactoring code for style preferences beyond what the linter flags
- Adding new tests for code changed by lint fixes
- Enabling additional lint rules beyond the current ruff/eslint config
- Fixing the 31 broken frontend tests (happy-dom issues — separate effort)

## Decisions

### 1. Apply auto-fixes first, then manual fixes on the clean baseline

**Decision**: Run `ruff check --fix && ruff format` and `eslint --fix` as the first step, commit the result, then address remaining manual issues on top.

**Rationale**: 296 of 433 findings are auto-fixable. Running auto-fix first creates a clean baseline that makes manual fixes easier to review. Auto-fixes are deterministic and safe — import reordering and formatting don't change behavior.

**Alternative considered**: Fix everything manually file-by-file. Rejected because it's 10x slower and the auto-fix output is identical to what a human would do for import sorting and formatting.

### 2. Suppress B008 (`Depends()` in defaults) via per-file-ignores, not inline noqa

**Decision**: Add `"app/routers/*" = ["B008"]` to `[tool.ruff.lint.per-file-ignores]` in `pyproject.toml`.

**Rationale**: All 27 B008 violations are in `app/routers/*.py` and are FastAPI's idiomatic `Depends()` pattern. This is a well-known false positive — ruff's own docs acknowledge it. A per-file-ignore is cleaner than 27 inline `# noqa: B008` comments and automatically covers future router functions.

**Alternative considered**: Inline `# noqa: B008` on each line. Rejected — too noisy, and every new router endpoint would need the comment.

**Alternative considered**: Global `ignore = ["B008"]`. Rejected — B008 is valid outside of FastAPI routers (e.g., in use cases or services). Only suppress where the pattern is idiomatic.

### 3. Fix F821 (undefined names) by adding missing imports, not removing references

**Decision**: Add the missing imports for `OutboxRecord`, `RestrictedSession`, and `_get_dev_token`.

**Rationale**: These are genuine bugs — the code references symbols that aren't imported. The references exist because the code works at runtime (lazy evaluation in type hints, or the test never reaches that branch), but they would fail if exercised. Adding imports is the correct fix; removing references would break functionality.

Specific cases:
- `OutboxRecord` in `app/models/upload.py` — likely a forward reference in a relationship
- `RestrictedSession` in 3 repository files — used in type annotations
- `_get_dev_token` in `tests/integration/test_api.py` — helper function referenced but not imported

### 4. Fix B904 (exception chaining) with `from err` or `from None`

**Decision**: Add `from err` to re-raises that should preserve the original traceback, and `from None` where the original exception is intentionally suppressed.

**Rationale**: Lost exception context makes debugging harder. The 4 violations are in auth providers and the transform use case — all error paths where knowing the root cause matters.

- `dev_provider.py`: `raise AuthenticationError(...) from err` — preserve context
- `workos_provider.py` (2 cases): `raise ... from err` — preserve WorkOS error context
- `transform.py`: `raise ... from err` — preserve DuckDB/SQL error context

### 5. Handle `react-hooks/exhaustive-deps` warnings case-by-case, not blanket-suppress

**Decision**: Review each of the 3 `exhaustive-deps` warnings individually. Either add the missing dependency (if safe) or suppress with an `// eslint-disable-next-line` comment with an explanation of why the omission is intentional.

**Rationale**: These warnings often indicate real stale-closure bugs, especially in complex components like `ChatContext`. Blanket suppression would hide genuine issues. However, some dependency omissions are intentional (e.g., stable refs, dispatch functions) and should be documented.

### 6. Suppress `testing-library/no-unnecessary-act` via bulk inline comments

**Decision**: Add `// eslint-disable-next-line testing-library/no-unnecessary-act` to each of the 16 `act()` calls.

**Rationale**: These test files use `act()` wrappers that may or may not be unnecessary — it depends on the async behavior of the component under test. Since 31/34 frontend tests are already failing (happy-dom issues), we can't safely verify whether removing `act()` breaks tests. Suppress now with inline comments; revisit when the test suite is green.

**Alternative considered**: Remove all `act()` wrappers now. Rejected — can't verify correctness with broken test suite.

### 7. Handle E402 (imports not at top) with targeted noqa comments

**Decision**: Add `# noqa: E402` to the 3 repository `__init__.py` files where imports are after module-level code. Fix the 3 test file violations by reorganizing imports.

**Rationale**: The repository `__init__.py` files have imports after class/function definitions intentionally — they re-export symbols that depend on definitions earlier in the file. The test file violations are simple reordering fixes.

## Risks / Trade-offs

**[Risk] Auto-fix changes import order, breaking circular imports** → Mitigation: Run backend tests after auto-fix to catch any import cycles. Ruff's isort respects `TYPE_CHECKING` blocks and won't break them.

**[Risk] `react-hooks/exhaustive-deps` fixes change component re-render behavior** → Mitigation: Review each case individually. If adding a dependency could cause infinite loops, suppress with a comment explaining why.

**[Risk] B905 `zip(strict=True)` changes runtime behavior** → Mitigation: `strict=True` will raise `ValueError` if iterables have different lengths. This is actually safer, but verify the calling code expects equal-length iterables. The auto-fix adds `strict=False` by default (no behavior change).

**[Risk] Large diff is hard to review** → Mitigation: Split into 2 commits: (1) auto-fix only (mechanical, safe to rubber-stamp), (2) manual fixes (small, reviewable). This is the most important structural decision for reviewability.
