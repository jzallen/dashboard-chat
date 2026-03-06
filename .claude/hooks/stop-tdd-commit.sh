#!/usr/bin/env bash
# ============================================================================
# Stop Hook: TDD Enforcement + Incremental Commits
# ============================================================================
# Fires when Claude finishes a response. If code changed:
#   1. Runs tests for affected service areas
#   2. Blocks (exit 2) if tests fail — Claude must fix before proceeding
#   3. Auto-commits if tests pass (husky pre-commit handles formatting)
# ============================================================================
set -uo pipefail

cd "$CLAUDE_PROJECT_DIR"

# Consume stdin (hook passes JSON on stdin; we don't need it here)
cat > /dev/null

# ---------------------------------------------------------------------------
# Detect uncommitted changes
# ---------------------------------------------------------------------------
CHANGED_TRACKED=$(git diff --name-only HEAD 2>/dev/null || true)
CHANGED_UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null || true)
ALL_CHANGED=$(printf '%s\n%s' "$CHANGED_TRACKED" "$CHANGED_UNTRACKED" | sed '/^$/d')

if [ -z "$ALL_CHANGED" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Classify changes by service area
# ---------------------------------------------------------------------------
HAS_BACKEND=false
HAS_FRONTEND=false
HAS_WORKER=false

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    backend/*)  HAS_BACKEND=true ;;
    frontend/*) HAS_FRONTEND=true ;;
    worker/*)   HAS_WORKER=true ;;
    shared/*)   HAS_FRONTEND=true; HAS_WORKER=true ;;
  esac
done <<< "$ALL_CHANGED"

# No service code changes (e.g. only docs, config) — stage without tests
if ! $HAS_BACKEND && ! $HAS_FRONTEND && ! $HAS_WORKER; then
  git add -u
  exit 0
fi

# ---------------------------------------------------------------------------
# Run tests for affected areas
# ---------------------------------------------------------------------------
FAILURES=""

if $HAS_BACKEND; then
  BE_OUT=$(cd "$CLAUDE_PROJECT_DIR/backend" && uv run pytest -x -q --tb=short 2>&1) || \
    FAILURES+="=== Backend Tests FAILED ===
${BE_OUT}

"
fi

if $HAS_FRONTEND; then
  FE_OUT=$(cd "$CLAUDE_PROJECT_DIR/frontend" && npx vitest run 2>&1) || \
    FAILURES+="=== Frontend Tests FAILED ===
${FE_OUT}

"
fi

if $HAS_WORKER; then
  WK_OUT=$(cd "$CLAUDE_PROJECT_DIR" && npm run test:worker 2>&1) || \
    FAILURES+="=== Worker Tests FAILED ===
${WK_OUT}

"
fi

if [ -n "$FAILURES" ]; then
  echo "$FAILURES" >&2
  echo "Tests must pass before proceeding. Fix the failing tests." >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# All tests pass — stage files (Claude will commit with a proper message)
# ---------------------------------------------------------------------------
# Stage tracked file changes
git add -u

# Stage new files in service directories (avoids committing stray root files)
for dir in backend frontend worker shared .claude; do
  [ -d "$dir" ] && git add "$dir/" 2>/dev/null || true
done

STAT=$(git diff --cached --stat | tail -1 | xargs)
if [ -z "$STAT" ]; then
  exit 0
fi

echo "Tests passed. Changes staged: ${STAT}"
exit 0
