<!-- DES-ENFORCEMENT : exempt -->
# `tools/test` Bazel target + gastown per-submission override

**Status:** design recommendation, not yet implemented
**Date:** 2026-05-10

## 1. Per-submission override answer

**No.** gastown v1.0.2 has no per-MR `test_command` override surface. Evidence:

- `gt mq submit --help` exposes `--branch / --epic / --issue / --priority / --resubmit / --skip-deps / --no-cleanup` only — no `--test-command` flag (`internal/cmd/mq_submit.go` flag definitions, ~line 78).
- The MR bead description is hard-coded to `branch / target / source_issue / rig / commit_sha / worker` (`mq_submit.go:241-250`); no test-command field is written.
- The Refinery resolves the test command exclusively from rig config: `getTestCommand(rigPath)` reads `settings/config.json -> merge_queue.test_command` and ignores everything else (`internal/cmd/mq_integration.go:775-786`, `internal/refinery/engineer.go:124-125, 384-385, 940-944`).
- Patrol formula interpolates `{{test_command}}` from `[vars.test_command]` only (`~/gt/.beads/formulas/mol-refinery-patrol.formula.toml`); the formula has no per-bead variable injection path.

**Recommended workaround:** make `merge_queue.test_command` point at a single dispatch script (`tools/test/test.sh`). To vary behaviour per MR, vary inputs the script can read (env, branch name, changed paths) — not the command itself. For one-off operator overrides, edit `settings/config.json` before submitting and revert after merge.

## 2. Recommended `tools/test/` topology

Place under `tools/test/` to sit alongside the existing `tools/{gh,gt,python}-toolchain/` siblings — that directory is already the home for cross-cutting dev infra and is excluded from service builds.

### Files

```
tools/test/
  BUILD.bazel
  test.sh         # canonical dispatcher (POSIX sh, runnable standalone)
```

### `tools/test/BUILD.bazel` sketch

```python
load("@rules_shell//shell:sh_binary.bzl", "sh_binary")

# Thin wrapper: `bazel run //tools/test -- --backend --ui`
# Does NOT depend on any py_library, js_library, or oci_image target.
# It just invokes pytest/vitest/npm in the source tree (data=[]).
sh_binary(
    name = "test",
    srcs = ["test.sh"],
    visibility = ["//visibility:public"],
    tags = ["manual", "no-sandbox"],
)

exports_files(["test.sh"])  # so merge queue can call it directly
```

Then add a top-level alias in `/workspaces/dashboard-chat/BUILD.bazel`:

```python
alias(name = "test", actual = "//tools/test:test", tags = ["manual"])
```

### `tools/test/test.sh` sketch

```sh
#!/usr/bin/env bash
set -euo pipefail

# Run from BUILD_WORKSPACE_DIRECTORY when invoked via `bazel run`,
# otherwise from the script's own repo-root resolution.
ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

backend=0; ui=0; agent=0; integration=0; acceptance=""

while [ $# -gt 0 ]; do case "$1" in
  --all)              backend=1; ui=1; agent=1 ;;
  --backend)          backend=1 ;;
  --ui)               ui=1 ;;
  --agent)            agent=1 ;;
  --integration)      integration=1 ;;
  --acceptance=*)     acceptance="${1#*=}" ;;
  -h|--help)          sed -n '2,40p' "$0"; exit 0 ;;
  *) echo "unknown flag: $1" >&2; exit 2 ;;
esac; shift; done

[ $backend -eq 0 ] && [ $ui -eq 0 ] && [ $agent -eq 0 ] && [ -z "$acceptance" ] && {
  echo "specify at least one: --backend|--ui|--agent|--all|--acceptance=<feature>" >&2; exit 2; }

rc=0
if [ $backend -eq 1 ]; then
  ignore="--ignore=tests/integration"
  [ $integration -eq 1 ] && ignore=""
  ( cd backend && uv run pytest -x --tb=short $ignore ) || rc=$?
fi
[ $ui -eq 1 ]    && ( cd reverse-proxy && npx vitest run )    || rc=${rc:-$?}
[ $agent -eq 1 ] && ( npm run test:agent )                || rc=${rc:-$?}
[ -n "$acceptance" ] && ( cd "tests/acceptance/$acceptance" && uv run --no-project pytest ) || rc=${rc:-$?}
exit $rc
```

Note: the agent suite is `npm run test:agent` (the repo has no `worker/` dir and no `test:worker` script — `package.json` exposes `test:agent`, `test:frontend`, `test:backend`, `test:all`).

### Example invocations

```
bazel run //tools/test -- --all
bazel run //tools/test -- --backend --ui
bazel run //tools/test -- --backend --integration
bazel run //tools/test -- --acceptance=refactor-dataset-layer-harness
./tools/test/test.sh --backend          # standalone, no Bazel daemon
```

## 3. `merge_queue.test_command` recommendation

Set to the **standalone script path**, not `bazel run`:

```toml
test_command = "./tools/test/test.sh --backend"
```

Rationale: refinery patrols already do `cd <rigPath>` then `sh -c "$test_command"` (`mq_integration.go:792-803`). Calling the script directly avoids spinning the Bazel daemon inside the refinery worker (Bazel cache is per-user; refinery runs as a different uid in some setups, causing cache thrash) and keeps gate latency low. Bazel-daemon invocation stays as the *developer* affordance via `bazel run //tools/test`.

Expand to `--backend --ui --agent` once the UI/agent suites stabilise under refinery isolation. Do not include `--integration` or `--acceptance=*` in the gate.

## 4. Trade-offs

- **Not covered by `//tools/test`:** Bazel-native test caching, hermetic execution, remote execution. Tests run against the source tree using each subsystem's own venv/node_modules. If you later want incremental gating, the existing `//backend:tests` and `//reverse-proxy:test` test_suites do that — keep them.
- **CI service targets vs. tools targets:** `//backend:image_tar`, `//reverse-proxy:image_tar`, `//agent:image_tar`, `//auth-proxy:image_tar` exist for GitHub Actions container builds and **must stay untouched**. `//tools/test:test` is only for local dev + merge-queue gating. Do not cross-wire them.
- **Suite duplication risk:** `npm run test:all` already exists. The new script is a near-duplicate with selectors. Acceptable because (a) `test:all` can't subset, (b) refinery wants a single entry point, (c) we avoid teaching refinery about `npm`/`turbo`.
- **No-rollback note:** this change has no production blast radius — it's dev tooling. Rollback = `git revert` of the introducing commit + revert of `merge_queue.test_command` to its current value.

## 5. Implementation order (atomic commits)

1. **`feat(tools): add tools/test dispatcher script`** — add `tools/test/test.sh` + `tools/test/BUILD.bazel` only. No rig/CLAUDE.md changes. Verify by running `./tools/test/test.sh --backend` locally.
2. **`feat(tools): expose //:test alias for tools/test`** — add the top-level alias in `/workspaces/dashboard-chat/BUILD.bazel`. Verify `bazel run //:test -- --backend`.
3. **`chore(rig): point merge_queue.test_command at tools/test`** — flip rig `settings/config.json` to `./tools/test/test.sh --backend`. Submit one trivial MR to confirm the refinery executes it cleanly before broadening the suite.
4. *(Later, separately)* expand to `--backend --ui --agent`, document in `CLAUDE.md`, and update the gastown skill notes if the override gap is ever closed upstream.
