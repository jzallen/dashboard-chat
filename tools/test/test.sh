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
#
# Selectors:
#   --backend       cd backend && (ruff check + ruff format --check) then
#                   pytest -x --tb=short [--ignore=tests/integration]
#                   (lint runs first; tests skip if lint fails)
#   --ui            cd frontend && npx vitest run
#   --agent         npm run test:agent
#   --all           shorthand for --backend --ui --agent
#   --integration   include backend tests/integration/ (default: excluded)
#   --acceptance=X  cd tests/acceptance/X && uv run --no-project pytest
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
set -euo pipefail

ROOT="${BUILD_WORKSPACE_DIRECTORY:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

backend=0
ui=0
agent=0
integration=0
acceptance=""

while [ $# -gt 0 ]; do
  case "$1" in
    --all)            backend=1; ui=1; agent=1 ;;
    --backend)        backend=1 ;;
    --ui)             ui=1 ;;
    --agent)          agent=1 ;;
    --integration)    integration=1 ;;
    --acceptance=*)   acceptance="${1#*=}" ;;
    -h|--help)        sed -n '1,30p' "$0"; exit 0 ;;
    *) echo "tools/test: unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ $backend -eq 0 ] && [ $ui -eq 0 ] && [ $agent -eq 0 ] && [ -z "$acceptance" ]; then
  echo "tools/test: specify at least one selector (--backend|--ui|--agent|--all|--acceptance=<feature>)" >&2
  exit 2
fi

rc=0

if [ $backend -eq 1 ]; then
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
    ( cd backend && uv run pytest -x --tb=short $ignore ) || rc=$?
  fi
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
