#!/usr/bin/env bash
# Bazel workspace status command — emits build identity stamps.
#
# All keys are STABLE_* so dependent actions stay cached across builds; only
# the version layer (which references these keys via expand_template stamp
# substitutions) rebuilds when the values change.
#
# Wired in .bazelrc:
#     build --workspace_status_command=tools/workspace_status.sh
set -euo pipefail

# Full 40-char SHA at HEAD; "unknown" if not in a git tree.
if commit=$(git rev-parse HEAD 2>/dev/null); then
    echo "STABLE_GIT_COMMIT ${commit}"
else
    echo "STABLE_GIT_COMMIT unknown"
fi

# JSON boolean: "true" iff working tree has uncommitted changes, "false" otherwise.
# Off-tree builds default to "false" so version.json stays valid JSON; the SHA
# field will already read "unknown" in that case, which is the real signal.
if dirty=$(git status --porcelain 2>/dev/null); then
    if [ -n "${dirty}" ]; then
        echo "STABLE_GIT_DIRTY true"
    else
        echo "STABLE_GIT_DIRTY false"
    fi
else
    echo "STABLE_GIT_DIRTY false"
fi

# RFC3339 UTC timestamp at build time. Honors SOURCE_DATE_EPOCH for reproducible builds.
if [ -n "${SOURCE_DATE_EPOCH:-}" ]; then
    echo "STABLE_BUILD_TIMESTAMP $(date -u -d "@${SOURCE_DATE_EPOCH}" +%Y-%m-%dT%H:%M:%SZ)"
else
    echo "STABLE_BUILD_TIMESTAMP $(date -u +%Y-%m-%dT%H:%M:%SZ)"
fi
