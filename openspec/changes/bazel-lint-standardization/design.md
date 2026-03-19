## Context

Lint today runs outside the Bazel graph:
- TypeScript/React: `npx eslint .` (root-level)
- Python: `uv run ruff check .` + `uv run ruff format --check .` (inside `backend/`)
- CI: a separate `lint` job installs Node and Python independently, outside Bazel's hermetic environment

The `test` job already runs `bazel test //...` and handles frontend, worker, and backend tests. The goal is to extend `//...` to include lint so the CI `lint` job can be removed and the dev-loop interface collapses to one command.

Constraints:
- Existing test targets use `tags = ["no-sandbox"]` for JS targets — same env available for lint
- `MODULE.bazel` currently uses `aspect_rules_js`, `rules_python`, `rules_oci`
- The ESLint config lives at the repo root (`eslint.config.js`) and must be reachable from each lint target

## Goals / Non-Goals

**Goals:**
- `bazel test //frontend:lint`, `bazel test //worker:lint`, `bazel test //backend:lint` all pass on a clean codebase
- `bazel test //...` includes all three lint targets; no separate invocation needed
- Bazel's content-hash caching means lint only re-runs when affected source files change
- CI `lint` job removed; `release` job's `needs:` updated accordingly

**Non-Goals:**
- Auto-fix via Bazel (lint targets are read-only check; fixes still run via `npm run lint:fix` / `uv run ruff check --fix`)
- Replacing the pre-commit hook (stays as-is for dev ergonomics)
- Adding `rules_lint` from `aspect-build` (avoid a new external dependency; the `sh_test` approach is sufficient)

## Decisions

### Decision 1: `sh_test` over `genrule` or `rules_lint`

**Chosen**: `sh_test` with a small shell script per service.

**Alternatives considered**:
- `genrule` — produces build outputs, not test results; won't appear in `bazel test //...` without additional wrapping
- `aspect-build/rules_lint` — purpose-built but adds a new `MODULE.bazel` entry and lock churn for three simple targets
- `py_test` wrapper for Ruff — unnecessary indirection; a shell invocation is simpler

**Rationale**: `sh_test` is a first-class Bazel test rule, appears in `bazel test //...`, and supports `tags = ["no-sandbox"]` exactly like the existing vitest targets. No new Bazel module dependencies.

### Decision 2: One shell script per service, committed to the repo

Each service gets a `lint_test.sh` at its root (`frontend/lint_test.sh`, `worker/lint_test.sh`, `backend/lint_test.sh`). The `sh_test` target points to it as `srcs[0]`.

**Rationale**: Shell scripts are readable, debuggable, and runnable directly without Bazel (`bash frontend/lint_test.sh`). Avoids `cmd` string escaping in BUILD files.

### Decision 3: Declare source globs as `data` deps for caching

Each `sh_test` target lists its source globs in `data` so Bazel tracks file changes and invalidates the cached test result when sources change.

```python
sh_test(
    name = "lint",
    srcs = ["lint_test.sh"],
    data = glob(["src/**/*.ts", "src/**/*.tsx", "eslint.config.js", ...]),
    tags = ["no-sandbox"],
    size = "small",
)
```

**Note on `size`**: The design originally specified `size = "medium"` (300s timeout). After running Bazel, lint targets consistently complete in well under 60 seconds (the `small` timeout), so `size = "small"` was chosen to reflect observed runtime and avoid over-allocating Bazel's timeout budget. If lint grows substantially (e.g., many more source files), revisit.

### Decision 4: Root `eslint.config.js` — run from repo root, not from package subdirectory

ESLint is configured at the repo root. Lint scripts for `frontend` and `worker` run from the workspace root (not `chdir` into the subdir), passing the relevant path as an argument:
```bash
npx eslint frontend/src
npx eslint worker
```
This avoids duplicating ESLint config and matches the current `npm run lint:frontend` / `lint:worker` behavior.

### Decision 5: CI `lint` job removed; `release` needs updated

The `release` job currently lists `needs: [lint, test]`. After removing `lint`, it becomes `needs: [test]`. The lint coverage is preserved because `bazel test //...` now includes the lint targets.

## Risks / Trade-offs

**[Risk] `no-sandbox` lint targets can pass locally but fail in CI if tool versions differ**
→ Mitigation: CI uses `setup-bazel` with a hermetic disk cache; npm/uv versions are pinned in `package-lock.json` and `uv.lock`. Risk is the same as the existing no-sandbox vitest targets.

**[Risk] Root-level `eslint.config.js` is not a declared Bazel dep — cache may not invalidate on config change**
→ Mitigation: Add `eslint.config.js` (and `eslint.config.*.js` if any) explicitly to the `data` list of each JS lint target.

**[Risk] `sh_test` targets are not platform-hermetic (bash assumed)**
→ Mitigation: CI and devcontainer both run on Linux. Acceptable for a lint target.

**[Risk] `bazel test //...` includes `manual`-tagged targets — lint should NOT be `manual`**
→ No action needed: `manual` targets are excluded from `//...` by default; new lint targets omit `manual` so they're included.

## Migration Plan

1. Add `frontend/lint_test.sh`, `worker/lint_test.sh`, `backend/lint_test.sh`
2. Add `lint` `sh_test` target to each `BUILD.bazel`
3. Verify `bazel test //frontend:lint //worker:lint //backend:lint` passes locally
4. Remove `lint` job from `.github/workflows/ci.yml`; update `release` job `needs`
5. Open PR; CI `test` job implicitly validates lint via `bazel test //...`

No rollback complexity — lint targets are additive. If removed, CI falls back to the `lint` job pattern (reversible by reverting the workflow change).

## Open Questions

- None. The approach is straightforward given existing `no-sandbox` test patterns.
