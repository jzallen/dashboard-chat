"""Reversibility acceptance — Slice 3 / MR-2.

Scenarios from `docs/feature/frontend-coexistence/distill/route-reverts-to-library-mode-when-loader-removed.feature`.

ADR-034 §"Reversibility" promises symmetric escape hatches at two levels:
(a) MR-0 revert rips out framework mode entirely, (b) per-route revert
removes a `loader` export to revert that route to library-mode without
touching the component file.

These scenarios validate (b) by reverting the Slice-2 migrated route
during MR-2 and asserting the post-revert behavior matches the
pre-Slice-2 baseline.
"""

from __future__ import annotations

import os
import re
import subprocess

import pytest

from driver import FrontendCoexistenceDriver

pytestmark = [
    pytest.mark.skip(
        reason="DISTILL: pending DELIVER phase 03 (Slice-3 / MR-2 — reversibility + chat opt-out) per roadmap.json",
    ),
    pytest.mark.real_io,
    pytest.mark.slice_3,
]


@pytest.fixture(scope="module")
def reverted_route_path() -> str:
    """The path of the route MR-2 reverted from framework-mode back to library-mode."""
    return os.environ.get("MIGRATED_ROUTE_PATH", "/login")


@pytest.mark.needs_compose_stack
def test_reverted_route_no_longer_ssrs_loader_data(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    reverted_route_path: str,
) -> None:
    """The reverted route's response is a library-mode shell with no pre-rendered loader data."""
    probe = driver.get(reverted_route_path)
    assert probe.status == 200, f"expected 200, got {probe.status}"
    assert "text/html" in probe.content_type.lower(), (
        f"reverted route Content-Type was {probe.content_type!r}; expected text/html"
    )
    # Library-mode invariant: the `<div id="root">` is empty (or whitespace-only)
    # at the SSR pass; data fetching happens client-side after hydration.
    root_match = re.search(
        r'<div\s+id=["\']root["\']\s*>(.*?)</div>',
        probe.body,
        flags=re.DOTALL,
    )
    assert root_match, (
        f"reverted route response missing `<div id=\"root\">`. Body head: {probe.body[:500]!r}"
    )
    inner = root_match.group(1).strip()
    # Permissive: small inner content (e.g., a brief loading sentinel) is acceptable.
    # The strict contract is: no pre-rendered loader output that would only appear
    # via SSR'd dehydrated state.
    assert len(inner) < 200, (
        f"reverted route still appears to have SSR'd content (inner length {len(inner)}). "
        f"Expected library-mode shell with empty/minimal `<div id=\"root\">`. Inner head: {inner[:200]!r}"
    )


@pytest.mark.needs_compose_stack
def test_reverted_route_response_has_no_dehydrated_state(
    requires_compose_stack: None,
    driver: FrontendCoexistenceDriver,
    reverted_route_path: str,
) -> None:
    """The reverted route's HTML body does NOT contain the dehydratedState payload."""
    probe = driver.get(reverted_route_path)
    body = probe.body
    # The dehydrated state ships only when a server `loader` ran. With the loader
    # removed, the SSR pass is a library-mode pass-through; no dehydration occurs.
    has_dehydrated = (
        '"dehydratedState"' in body
        or "useLoaderData" in body
        # The exact marker is RRv7-internal. The contract is: no server-prefetched
        # cache state in the HTML.
    )
    assert not has_dehydrated, (
        f"reverted route response still contains a dehydratedState marker — the "
        f"`loader` export removal did not fully revert to library mode."
    )


@pytest.mark.needs_repo_post_mr0_state
def test_route_component_file_byte_unchanged_across_migrate_then_revert(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """Across migrate-then-revert, the route COMPONENT file is byte-unchanged.

    The only `git diff` between pre-Slice-2 and post-MR-2 should be the
    `loader` export being added then removed. The component body, imports
    (other than the loader-specific ones), and default export are
    byte-identical.
    """
    # Operationalized via a `git diff` between two named refs:
    #   - PRE_SLICE_2_REF = the ref of the commit just before Slice-2 lands.
    #   - POST_MR_2_REF = HEAD after MR-2 reverts the loader.
    # DELIVER provides these refs via env vars. DISTILL fixes the contract.
    pre_ref = os.environ.get("PRE_SLICE_2_REF")
    post_ref = os.environ.get("POST_MR_2_REF", "HEAD")
    if not pre_ref:
        pytest.fail(
            "PRE_SLICE_2_REF env var is required for this scenario. "
            "DELIVER's Slice-3 / MR-2 records the ref before un-skipping this test."
        )
    route_file = os.environ.get(
        "MIGRATED_ROUTE_MODULE_PATH",
        "frontend/app/routes/login.tsx",
    )
    result = subprocess.run(
        ["git", "diff", "--", route_file],
        cwd=driver.repo_root,
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "GIT_PAGER": "cat"},
    )
    # We expect the diff against pre_ref..post_ref to show ONLY loader-related
    # lines added and then removed — netting to zero.
    diff_result = subprocess.run(
        ["git", "diff", f"{pre_ref}..{post_ref}", "--", route_file],
        cwd=driver.repo_root,
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "GIT_PAGER": "cat"},
    )
    assert diff_result.returncode == 0, (
        f"`git diff {pre_ref}..{post_ref}` failed: {diff_result.stderr.strip()}"
    )
    # The contract: the net diff is empty (loader added, loader removed; the rest
    # of the file is unchanged). A non-empty diff means MR-2 changed something
    # beyond the loader.
    net_changes = [
        line for line in diff_result.stdout.splitlines()
        if line.startswith(("+", "-")) and not line.startswith(("+++", "---"))
    ]
    assert not net_changes, (
        f"`{route_file}` has {len(net_changes)} net change(s) across "
        f"{pre_ref}..{post_ref}; reversibility requires zero net component-body diff. "
        f"First 10 net change lines: {net_changes[:10]!r}"
    )


@pytest.mark.needs_repo_post_mr0_state
def test_slice_2_and_mr_2_diffs_are_mirror_images(
    requires_repo_post_mr0_state: None,
    driver: FrontendCoexistenceDriver,
) -> None:
    """The forward (Slice-2) and reverse (MR-2) diffs are mirror images.

    DELIVER provides refs naming the Slice-2 merge and the MR-2 merge.
    The test asserts the line-by-line inversion property.
    """
    pre_slice2 = os.environ.get("PRE_SLICE_2_REF")
    post_slice2 = os.environ.get("POST_SLICE_2_REF")
    post_mr2 = os.environ.get("POST_MR_2_REF", "HEAD")
    if not (pre_slice2 and post_slice2):
        pytest.fail(
            "PRE_SLICE_2_REF and POST_SLICE_2_REF env vars are required for this scenario."
        )
    route_file = os.environ.get(
        "MIGRATED_ROUTE_MODULE_PATH",
        "frontend/app/routes/login.tsx",
    )
    forward = subprocess.run(
        ["git", "diff", f"{pre_slice2}..{post_slice2}", "--", route_file],
        cwd=driver.repo_root,
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "GIT_PAGER": "cat"},
    )
    reverse = subprocess.run(
        ["git", "diff", f"{post_slice2}..{post_mr2}", "--", route_file],
        cwd=driver.repo_root,
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "GIT_PAGER": "cat"},
    )
    assert forward.returncode == 0 and reverse.returncode == 0, (
        f"git diff failed: forward={forward.stderr!r} reverse={reverse.stderr!r}"
    )
    forward_added = {
        line[1:]
        for line in forward.stdout.splitlines()
        if line.startswith("+") and not line.startswith("+++")
    }
    forward_removed = {
        line[1:]
        for line in forward.stdout.splitlines()
        if line.startswith("-") and not line.startswith("---")
    }
    reverse_added = {
        line[1:]
        for line in reverse.stdout.splitlines()
        if line.startswith("+") and not line.startswith("+++")
    }
    reverse_removed = {
        line[1:]
        for line in reverse.stdout.splitlines()
        if line.startswith("-") and not line.startswith("---")
    }
    # Mirror invariant: reverse_removed == forward_added; reverse_added == forward_removed.
    assert reverse_removed == forward_added, (
        f"reverse diff did not remove exactly what forward diff added. "
        f"Forward-added (count {len(forward_added)}), reverse-removed (count {len(reverse_removed)})."
    )
    assert reverse_added == forward_removed, (
        f"reverse diff did not re-add exactly what forward diff removed. "
        f"Forward-removed (count {len(forward_removed)}), reverse-added (count {len(reverse_added)})."
    )
