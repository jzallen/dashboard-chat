#!/usr/bin/env python3
"""Verify pnpm-workspace.yaml, .bazelignore, and pnpm-lock.yaml are consistent.

Catches the regression pattern where a new workspace package lands without
all three files being updated, causing Bazel CI to fail post-merge with
either `npm_link_all_packages() may only be called in [...] workspace
projects` (lockfile out of date) or `verify_node_modules_ignored` (missing
.bazelignore entry).

Designed to be cheap (sub-second) so it can gate every code-touch MR via
tools/test/test.sh's --auto path without latency cost.

Run from anywhere; resolves repo root from the script's own location.
Exit 0 on success, 1 on any inconsistency.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WORKSPACE_ROOTS = ("frontend", "agent", "auth-proxy", "shared")


def read_pnpm_workspace_packages() -> set[str]:
    """Parse the list-of-strings under `packages:` in pnpm-workspace.yaml."""
    text = (REPO_ROOT / "pnpm-workspace.yaml").read_text()
    packages: set[str] = set()
    in_packages = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped == "packages:":
            in_packages = True
            continue
        if not in_packages:
            continue
        if line.startswith(" ") and stripped.startswith("- "):
            packages.add(stripped[2:].strip())
        elif stripped and not line.startswith(" "):
            break
    return packages


def read_bazelignore_entries() -> set[str]:
    text = (REPO_ROOT / ".bazelignore").read_text()
    return {
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def read_pnpm_lock_importers() -> set[str]:
    """Keys directly under `importers:` (excluding the root `.`)."""
    text = (REPO_ROOT / "pnpm-lock.yaml").read_text()
    importers: set[str] = set()
    in_importers = False
    key_re = re.compile(r"^  ([^\s:][^:]*):\s*$")
    for line in text.splitlines():
        if line == "importers:":
            in_importers = True
            continue
        if not in_importers:
            continue
        if line and not line[0].isspace():
            break
        m = key_re.match(line)
        if m:
            key = m.group(1).strip().strip("'\"")
            if key != ".":
                importers.add(key)
    return importers


def find_package_jsons_on_disk() -> set[str]:
    """Directories containing a package.json under a workspace root, excluding node_modules."""
    found: set[str] = set()
    for root in WORKSPACE_ROOTS:
        root_path = REPO_ROOT / root
        if not root_path.is_dir():
            continue
        for pkg_json in root_path.rglob("package.json"):
            if "node_modules" in pkg_json.parts:
                continue
            rel = pkg_json.parent.relative_to(REPO_ROOT)
            found.add(str(rel))
    return found


def main() -> int:
    workspaces = read_pnpm_workspace_packages()
    bazelignore = read_bazelignore_entries()
    lock_importers = read_pnpm_lock_importers()
    on_disk = find_package_jsons_on_disk()

    errors: list[str] = []

    for ws in sorted(on_disk - workspaces):
        errors.append(
            f"package.json exists at {ws}/ but the path is missing from pnpm-workspace.yaml.\n"
            f"    Fix: add `- {ws}` under `packages:` in pnpm-workspace.yaml."
        )

    for ws in sorted(workspaces - on_disk):
        errors.append(
            f"pnpm-workspace.yaml lists `{ws}` but no package.json exists there.\n"
            f"    Fix: remove `- {ws}` from pnpm-workspace.yaml."
        )

    for ws in sorted(workspaces):
        entry = f"{ws}/node_modules"
        if entry not in bazelignore:
            errors.append(
                f"Workspace `{ws}` is missing its node_modules from .bazelignore.\n"
                f"    Fix: add `{entry}` to .bazelignore."
            )

    for ws in sorted(workspaces - lock_importers):
        errors.append(
            f"Workspace `{ws}` is missing from pnpm-lock.yaml's importers.\n"
            f"    Fix: regenerate the lockfile — temporarily set package.json's\n"
            f"          packageManager to pnpm@9.0.0, run\n"
            f"          `pnpm install --lockfile-only --ignore-scripts`,\n"
            f"          then revert the packageManager field."
        )

    for ws in sorted(lock_importers - workspaces):
        errors.append(
            f"pnpm-lock.yaml has a stale importer for `{ws}` not in pnpm-workspace.yaml.\n"
            f"    Fix: regenerate the lockfile (see instructions above)."
        )

    if errors:
        print("✗ workspace consistency check FAILED\n", file=sys.stderr)
        for i, err in enumerate(errors, 1):
            print(f"{i}. {err}\n", file=sys.stderr)
        print(
            "These checks catch the regression pattern where a new workspace lands without\n"
            "all three files being updated, causing post-merge Bazel CI failures.",
            file=sys.stderr,
        )
        return 1

    print(
        f"✓ workspace consistency: {len(workspaces)} workspaces "
        f"({', '.join(sorted(workspaces))}) registered in "
        f"pnpm-workspace.yaml, .bazelignore, and pnpm-lock.yaml"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
