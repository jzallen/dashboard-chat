"""US-203 — Session list renders most-recent-first; caps at 5 in nav;
paginates at 30; cross-tab refreshes via projection-stream SSE.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-203-session-list-renders-most-recent-first.feature`

MR-2 dependency: the NEW `/projection/stream` SSE endpoint (DWD-9; per
the handoff "Open items" O2) lands in MR-2 DELIVER. The cross-tab
scenario un-skips when it ships.
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_2,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(reason="DELIVER-deferred to MR-2; un-skip when loading_session_list + session_list_visible land")
@pytest.mark.happy_path
def test_session_list_renders_sorted_most_recent_first(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """4 sessions with timestamps T1<T2<T3<T4 → list renders T4..T1.

    Asserts the rendered DOM order matches descending last_active_at;
    each row carries title (truncated first message) + recency timestamp.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-2")
@pytest.mark.happy_path
def test_recent_sessions_nav_caps_at_five_rows(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """10 sessions in a project → recent-sessions nav rail shows top 5."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-2")
@pytest.mark.boundary
def test_zero_sessions_project_enters_no_sessions_empty_state_sub_shape(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """0 sessions → session_list_visible with no_sessions_empty_state sub-shape (DWD-1)."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-2; pagination boundary")
@pytest.mark.happy_path
def test_session_list_is_paginated_for_projects_with_more_than_thirty_sessions(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """50 sessions → page 1 carries 30 items; cursor non-null; Load More appends 20."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(
    reason=(
        "DELIVER-deferred to MR-2; un-skip when the `/projection/stream` SSE "
        "endpoint lands (DWD-9 / handoff O2). The cross-tab refresh contract "
        "needs the new XREAD BLOCK consumer on the FlowEventLog adapter."
    )
)
@pytest.mark.happy_path
def test_session_created_in_other_tab_refreshes_list_within_one_second(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Tab A subscribed to projection-stream; Tab B creates session → Tab A refreshes <1s."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-2; un-skip when harness.j002.get_session_list ships")
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_asserts_session_list_ordering(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """`harness.j002.get_session_list()` returns items in DESC order matching FE render."""
    pytest.fail("not yet implemented")
