## 1. Lint Shell Scripts

- [x] 1.1 Create `frontend/lint_test.sh` — runs `npx eslint frontend/src` from repo root, executable
- [x] 1.2 Create `worker/lint_test.sh` — runs `npx eslint worker` from repo root, executable
- [x] 1.3 Create `backend/lint_test.sh` — runs `cd backend && uv run ruff check . && uv run ruff format --check .`, executable

## 2. Bazel BUILD Updates

- [x] 2.1 Add `//frontend:lint` `sh_test` target to `frontend/BUILD.bazel` with source globs and `eslint.config.js` in `data`, `tags = ["no-sandbox"]`
- [x] 2.2 Add `//worker:lint` `sh_test` target to `worker/BUILD.bazel` with source globs and `eslint.config.js` in `data`, `tags = ["no-sandbox"]`
- [x] 2.3 Add `//backend:lint` `sh_test` target to `backend/BUILD.bazel` with Python source globs and `pyproject.toml` in `data`, `tags = ["no-sandbox"]`

## 3. Verification

- [x] 3.1 Run `bazel test //frontend:lint //worker:lint //backend:lint` locally — all three PASS
- [x] 3.2 Run `bazel test //...` and confirm lint targets appear in the output (not skipped/manual)
- [x] 3.3 Verify cache works: run `bazel test //frontend:lint` twice without changes — second run is `(cached)`
- [x] 3.4 Introduce a deliberate ESLint violation, confirm `//frontend:lint` FAILS; revert

## 4. CI Update

- [x] 4.1 Remove the `lint` job from `.github/workflows/ci.yml`
- [x] 4.2 Update `release` job `needs:` from `[lint, test]` to `[test]`
- [x] 4.3 Remove `actions/setup-node` and `actions/setup-python` steps that were only needed by the `lint` job (if not used elsewhere)
