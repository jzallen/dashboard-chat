# Backlog: Bazel Lint Standardization

## Goal

Add ESLint and Ruff as Bazel targets so that `bazel test //...` covers lint, build,
and tests — fully standardizing the interface across all three services.

## Current State

Lint runs outside Bazel via npm scripts (`npx eslint .`) and uv (`uv run ruff check .`).
The CI `lint` job installs Node and Python separately, outside the Bazel graph.

## Desired State

- `//frontend:lint` — ESLint over frontend sources
- `//worker:lint` — ESLint over worker sources
- `//backend:lint` — Ruff check + format check over backend sources
- All lint targets included in `bazel test //...`
- CI `lint` job removed; single `test` job covers everything

## Why This Matters

- One command (`bazel test //...`) is the complete correctness check
- Bazel's caching means lint only re-runs when affected files change
- Consistent interface between local dev and CI

## References

- Current lint scripts: `package.json` (`lint`, `lint:fix`, `lint:frontend`, etc.)
- Current CI lint job: `.github/workflows/ci.yml` `lint` job
- Bazel ESLint rule options: `aspect-build/rules_lint`, or custom `genrule`-based approach
- Bazel Ruff rule options: `aspect-build/rules_lint` (includes ruff support)
