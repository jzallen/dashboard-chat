"""US-207 — Project switches retarget project chip + session list atomically
within 300ms p95; in-flight chat turn cancelled; agent never receives a
mismatched (project_id, session_id); cache invalidation closes R9.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-207-project-switching-is-atomic.feature`

MR-4 — load-bearing for the K-J002-4 North Star. Validates IC-J002-4.
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_4,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; un-skip when switching_project state lands")
@pytest.mark.happy_path
def test_switching_projects_atomically_retargets_active_scope_within_300ms_p95(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Q4 → Q3 switch: chip + session list paint together; <300ms p95; no Q4 sessions in Q3 list."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; SSE cancellation contract — load-bearing for K-J002-4")
@pytest.mark.error_path
@pytest.mark.property
def test_chat_turn_in_flight_during_project_switch_is_cancelled_before_new_loader_runs(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """IC-J002-4: in-flight SSE closes; agent NEVER receives (Q3.project_id, Q4.session_id) pair.

    Asserts via agent's request-log inspection that no such (project_id, session_id)
    tuple is ever present in any chat-turn request during the switch window.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; deep-link mid-session switch")
@pytest.mark.happy_path
def test_deep_link_mid_session_switches_projects_via_loader(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """RRv7 loader runs on /projects/q3-sales nav; J-002 emits switching_project_intent."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; access_revoked path")
@pytest.mark.error_path
def test_switching_to_access_revoked_project_surfaces_named_diagnostic(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Stale link to revoked project → scope_mismatch_terminal with cause "access_revoked";
    J-002 does NOT transition through project_selected for the revoked project at any point."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; un-skip when harness.j002.switch_project ships")
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_asserts_atomic_switching_and_sse_cancellation(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """harness.j002.switch_project + assert_scope + assert_session_active(any)==null +
    assertion that the agent's request log shows SSE closure before completion."""
    pytest.fail("not yet implemented")
