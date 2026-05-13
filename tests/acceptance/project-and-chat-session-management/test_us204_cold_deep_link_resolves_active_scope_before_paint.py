"""US-204 — Cold deep-link to /projects/:id resolves `active_scope` before
the page paints; cross-tenant / project-not-found land at
`scope_mismatch_terminal`; back-to-projects re-enters resolution.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-204-cold-deep-link-resolves-active-scope-before-paint.feature`

Slice 1 (MR-1) walking-skeleton extension. Exercises ScopeResolver
invariant 4 (ADR-029 §1) at first paint via the SSR'd `project-detail`
route loader.
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_1,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; un-skip when /projects/:projectId loader lands")
@pytest.mark.happy_path
def test_cold_deep_link_to_project_resolves_active_scope_before_paint(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Cold GET /projects/q4-analytics → SSR'd HTML carries project_id pre-paint.

    Asserts: project chip = "Q4 Analytics" in the first response body
    (no "Loading..." or "Default Project" placeholder); first-paint
    latency <300ms p95.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; un-skip when scope_mismatch_terminal lands")
@pytest.mark.error_path
def test_cross_tenant_deep_link_lands_in_scope_mismatch_terminal(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Cross-tenant /projects/:id → scope_mismatch_terminal with cause "cross_tenant".

    Asserts: panel reads "This project is no longer accessible"; correlation
    reference "R-..." visible; Back-to-projects CTA present; NO project chip
    with cross-tenant project name is painted at any point in the body.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1")
@pytest.mark.error_path
@pytest.mark.boundary
def test_deep_link_to_deleted_project_surfaces_same_panel_with_project_not_found_cause(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Deleted project deep-link → scope_mismatch_terminal with cause "project_not_found"."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; back-to-projects re-entry path")
@pytest.mark.happy_path
def test_back_to_projects_cta_re_enters_resolving_initial_scope_with_intent_cleared(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Back-to-projects from scope_mismatch_terminal clears intent and re-resolves."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; intent_resource carry-through")
@pytest.mark.happy_path
def test_deep_link_with_intent_resource_carries_through_to_session_active(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Cold GET /projects/q4/datasets/sales → session_active with resource_id set on first paint."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; un-skip when harness.j002.open_deep_link ships")
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_drives_deep_link_resolution_for_both_happy_and_cross_tenant(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """`harness.j002.open_deep_link` drives both happy + cross-tenant assertions."""
    pytest.fail("not yet implemented")
