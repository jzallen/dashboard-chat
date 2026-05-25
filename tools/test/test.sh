#!/usr/bin/env bash
# tools/test/test.sh — selector-driven test dispatcher.
#
# Usage:
#   bazel run //tools/test -- --backend           # backend pytest
#   bazel run //tools/test -- --backend --ui      # backend + frontend
#   bazel run //tools/test -- --all               # backend + ui + agent
#   bazel run //tools/test -- --backend --integration   # include integration suite
#   bazel run //tools/test -- --acceptance=<feature>    # one acceptance suite
#   ./tools/test/test.sh --backend                # standalone (no Bazel daemon)
#   ./tools/test/test.sh --auto                   # content-aware refinery gate
#
# Selectors:
#   --backend       cd backend && (ruff check + ruff format --check) then
#                   pytest -x --tb=short [--ignore=tests/integration]
#                   (lint runs first; tests skip if lint fails)
#   --ui            cd frontend && npx vitest run
#   --ui-state      cd ui-state && npx vitest run
#   --agent         npm run test:agent
#   --all           shorthand for --backend --ui --ui-state --agent
#   --integration   include backend tests/integration/ (default: excluded)
#   --acceptance=X  cd tests/acceptance/X && uv run --no-project pytest
#   --auto          inspect the diff against origin/main and dispatch the
#                   relevant test suites by changed-file subtree:
#                     docs-only diff             → skip (exit 0)
#                     touches backend/           → --backend
#                     touches ui-state/          → --ui-state
#                     touches frontend/          → --ui
#                     touches agent/             → --agent
#                     touches shared/ or other   → --backend (safe default)
#                   Multiple subtrees compose: a diff touching both
#                   `backend/` and `ui-state/` runs both suites. Used by
#                   the merge queue as its test_command so that
#                   docs-only MRs (finalize, research, ADRs, README, skills)
#                   land in seconds while code changes gate on the
#                   relevant test suite. Pre-2026-05-15 only ran --backend
#                   on any non-docs diff; this left ui-state JS regressions
#                   (LEAF-B 5f4e635) and analogous gaps in other JS trees
#                   uncaught. Docs allowlist: docs/**, .claude/skills/**,
#                   .claude/settings.json, *.md (any path), README*,
#                   CHANGELOG*.
#
# Notes:
#   • When invoked via `bazel run`, BUILD_WORKSPACE_DIRECTORY is set; we cd
#     there. Otherwise we resolve repo root from the script's own location so
#     `./tools/test/test.sh` from the repo root works directly.
#   • The merge queue invokes this script directly (no Bazel daemon spin-up).
#     See docs/research/tools-test-targets-and-mq-override.md.
#   • `--integration` is gate-excluded by default because the integration suite
#     needs the docker compose stack (auth-proxy + api + agent + minio +
#     query-engine) which the refinery cannot bring up.
#   • `--auto` requires a reachable `origin/main` ref (the refinery rebases
#     onto it before invoking the gate, so this is satisfied in the MQ path).
#     If origin/main is unavailable or the diff is empty, --auto falls
#     through to --backend as the safe default.
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

backend=0
ui=0
ui_state=0
agent=0
integration=0
acceptance=""
auto=0

while [ $# -gt 0 ]; do
  case "$1" in
    --all)            backend=1; ui=1; ui_state=1; agent=1 ;;
    --backend)        backend=1 ;;
    --ui)             ui=1 ;;
    --ui-state)       ui_state=1 ;;
    --agent)          agent=1 ;;
    --auto)           auto=1 ;;
    --integration)    integration=1 ;;
    --acceptance=*)   acceptance="${1#*=}" ;;
    -h|--help)        sed -n '1,55p' "$0"; exit 0 ;;
    *) echo "tools/test: unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ $auto -eq 1 ]; then
  # Content-aware refinery gate. Inspect the diff against origin/main and
  # dispatch the relevant test suites by changed-file subtree. Docs-only
  # diffs exit 0 immediately. Any subtree match adds its selector; multiple
  # subtrees compose. A diff outside every recognized subtree falls
  # through to --backend as the safe default.
  changed=$(git diff --name-only origin/main...HEAD 2>/dev/null || true)
  if [ -z "$changed" ]; then
    echo "tools/test --auto: no diff against origin/main detected — running --backend as safe default"
    backend=1
  else
    auto_docs_only=1
    auto_unmatched=0
    while IFS= read -r f; do
      [ -z "$f" ] && continue
      case "$f" in
        docs/*|.claude/skills/*|.claude/settings.json|README*|CHANGELOG*|*.md)
          # docs allowlist — does not count as non-docs
          ;;
        backend/*)
          auto_docs_only=0
          backend=1
          ;;
        ui-state/*)
          auto_docs_only=0
          ui_state=1
          ;;
        frontend/*)
          auto_docs_only=0
          ui=1
          ;;
        agent/*)
          auto_docs_only=0
          agent=1
          ;;
        *)
          # File outside docs allowlist AND outside the four recognized
          # subtrees (e.g. shared/, worker/, root config files, top-level
          # build files). Default to backend as the safe choice.
          auto_docs_only=0
          auto_unmatched=1
          ;;
      esac
    done <<EOF
$changed
EOF
    if [ $auto_docs_only -eq 1 ]; then
      echo "tools/test --auto: docs-only diff — skipping test gate"
      echo "  changed files:"
      echo "$changed" | sed 's/^/    /'
      exit 0
    fi
    # If no recognized subtree was matched but there are non-docs changes
    # (e.g. shared/, root config files), run backend as the safe default.
    if [ $backend -eq 0 ] && [ $ui_state -eq 0 ] && [ $ui -eq 0 ] && [ $agent -eq 0 ]; then
      backend=1
    fi
    # If an unmatched-subtree file appeared alongside subtree-matched
    # files, also pull in backend as a belt-and-braces default for the
    # unmatched paths.
    if [ $auto_unmatched -eq 1 ] && [ $backend -eq 0 ]; then
      backend=1
    fi
    echo "tools/test --auto: code changes detected — dispatching:"
    [ $backend -eq 1 ]  && echo "  + --backend"
    [ $ui_state -eq 1 ] && echo "  + --ui-state"
    [ $ui -eq 1 ]       && echo "  + --ui"
    [ $agent -eq 1 ]    && echo "  + --agent"
  fi
fi

if [ $backend -eq 0 ] && [ $ui -eq 0 ] && [ $ui_state -eq 0 ] && [ $agent -eq 0 ] && [ -z "$acceptance" ]; then
  echo "tools/test: specify at least one selector (--backend|--ui|--ui-state|--agent|--all|--auto|--acceptance=<feature>)" >&2
  exit 2
fi

rc=0

if [ $backend -eq 1 ]; then
  # Workspace consistency — fail-fast before any test. Catches the regression
  # pattern where a new pnpm workspace lands without pnpm-workspace.yaml,
  # .bazelignore, and pnpm-lock.yaml all being updated together (post-merge
  # Bazel CI failure discovered during failure-simulation-consolidation MR-1).
  echo "▶ workspace consistency"
  python3 "$ROOT/tools/check_workspace_consistency.py" || rc=$?
  if [ $rc -ne 0 ]; then
    echo "✗ aborting: fix workspace consistency before running tests" >&2
    exit $rc
  fi
  # Lint first — fail-fast. CI runs `bazel test //... --test_tag_filters=lint`
  # which invokes ruff against the whole backend; gating on the same checks
  # here keeps the merge-queue and CI in lock-step (otherwise lint failures
  # slip through the queue and break main as discovered after Phase 3).
  echo "▶ backend lint"
  ( cd backend && uv run ruff check . && uv run ruff format --check . ) || rc=$?
  if [ $rc -eq 0 ]; then
    echo "▶ backend tests"
    ignore="--ignore=tests/integration"
    if [ $integration -eq 1 ]; then
      ignore=""
    fi
    ( cd backend && uv run --extra test pytest -x --tb=short $ignore ) || rc=$?
  fi
fi

if [ $ui_state -eq 1 ] && [ $rc -eq 0 ]; then
  echo "▶ ui-state"
  ( cd ui-state && npx vitest run ) || rc=$?
fi

if [ $ui -eq 1 ] && [ $rc -eq 0 ]; then
  echo "▶ ui"
  ( cd frontend && npx vitest run ) || rc=$?
fi

if [ $agent -eq 1 ] && [ $rc -eq 0 ]; then
  echo "▶ agent"
  npm run test:agent || rc=$?
fi

if [ -n "$acceptance" ] && [ $rc -eq 0 ]; then
  echo "▶ acceptance:$acceptance"
  if [ ! -d "tests/acceptance/$acceptance" ]; then
    echo "tools/test: tests/acceptance/$acceptance does not exist" >&2
    exit 2
  fi
  ( cd "tests/acceptance/$acceptance" && uv run --no-project pytest ) || rc=$?
fi

exit $rc
