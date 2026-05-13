"""US-202 — Returning Maya lands in her last-used project on sign-in.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-202-returning-user-lands-in-last-used-project.feature`

DISTILL produces these tests RED. DELIVER's MR-1 un-skips them as the
resolver and loaders land.
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_1,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; un-skip when the J-002 resolver settles last-used picks")
@pytest.mark.happy_path
def test_resolution_picks_project_carrying_most_recent_session(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Three projects; most-recent session is in Q4 Analytics → land there.

    Asserts: projection `state` = `project_selected`; `active_scope.project_id` =
    Q4 Analytics id; the org chip + project chip paint on the SAME first paint.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1")
@pytest.mark.happy_path
def test_projects_with_no_sessions_fall_back_to_lexicographic_smallest_name(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Three projects, all empty → land in the lex-smallest by name.

    Asserts the project chip = "Marketing 2026"; session list is empty
    (no-sessions empty-state sub-shape); welcome chips visible.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1")
@pytest.mark.boundary
@pytest.mark.property
def test_tie_broken_last_active_picks_lexicographic_smaller_project_id_deterministically(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Two projects with equal last_active_at → pick lexicographic-smaller id.

    Determinism assertion — repeated cold restarts produce identical results.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; OQ-J002-4 partial-result resolution")
@pytest.mark.error_path
@pytest.mark.degraded
def test_transient_list_sessions_failure_during_last_used_resolution_emits_degraded_event(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Partial-result resolution: one project's list_sessions 503s → fall back to remaining.

    Asserts: `last_used_resolution_degraded` event is emitted with the
    degraded project id; J-002 still reaches `project_selected` for the
    successful project within 800ms at p95.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-1; un-skip when harness.j002.assert_initial_project ships")
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_asserts_initial_project_resolution(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """`harness.j002.assert_initial_project("Q4 Analytics")` reads from the projection."""
    pytest.fail("not yet implemented")
