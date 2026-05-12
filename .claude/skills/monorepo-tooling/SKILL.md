---
name: monorepo-tooling
description: Use when working with npm workspaces, Turborepo, uv/pyproject.toml, or need to understand how the monorepo build system is structured.
---

# Monorepo Tooling

## npm Workspaces

Four packages in root `package.json`: `reverse-proxy`, `agent`, `auth-proxy`, `shared/chat`. Single `npm install` at root installs all. Cross-workspace deps use `"@dashboard-chat/shared-chat": "*"`. Root `package-lock.json` is the single lockfile.

## Turborepo

Task orchestration via `turbo.json`:
```bash
npm run build              # turbo run build (reverse-proxy only — agent has no build step)
npm run test               # turbo run test:run (reverse-proxy + agent in parallel)
npm run test:all           # JS tests via turbo + backend via uv run pytest
```
- `build` is cached by content hash; `test:run` and `dev` are never cached
- Backend is NOT in the turbo graph — separate Python project

## Bazel (Hermetic Builds)

Bazel 9.0.0 for hermetic builds and OCI images. Existing npm/uv commands still work.

```bash
bazel build //...                                # build everything
bazel test //...                                 # all tests
bazel build //:images                            # all 4 OCI images
bazel test //e2e:e2e --config=e2e                # e2e tests (requires Docker)
```

- Config: `MODULE.bazel` (bzlmod deps), `.bazelrc` (flags), per-service `BUILD.bazel`
- Disk cache at `~/.cache/bazel-disk`
- OCI images use `oci_load` (rules_oci v2.2.7)

For Bazel test targets per service, see the **tdd** skill.

## Python Dependencies (uv + pyproject.toml)

Managed via `backend/pyproject.toml` + `backend/uv.lock`. No `requirements.txt`.

```bash
cd backend && uv sync              # install all deps (including dev group)
cd backend && uv add <package>     # add a dependency
cd backend && uv lock              # regenerate lockfile after manual edits
```

- Runtime deps: `[project] dependencies`
- Dev deps: `[dependency-groups] dev`
- Production: `uv sync --no-dev`
