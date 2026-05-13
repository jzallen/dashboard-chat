"""US-206 — "+ New Session" produces instant welcome-state with no backend
write; session row is eagerly created on first message; no ghost rows
on navigate-away; transient create-session failure preserves composer
text.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-206-new-session-is-lazily-created-on-first-message.feature`

MR-3. Validates DWD-10 lazy-creation contract. Pure machine extension
(no schema delta).
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_3,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(reason="DELIVER-deferred to MR-3; un-skip when session_active_no_messages lands")
@pytest.mark.happy_path
def test_clicking_new_session_lands_in_welcome_state_with_no_backend_write(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """+ New Session → session_active_no_messages; session_id null; NO session row created.

    The backend's session count for the project is unchanged after the click.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-3; un-skip when first_message_sent invoke lands")
@pytest.mark.happy_path
def test_sending_first_message_eagerly_creates_session_with_title_from_message(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """first_message_sent → session_active; session row created with title=first_message[:80]."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-3; no-ghost-row invariant")
@pytest.mark.boundary
@pytest.mark.happy_path
def test_navigating_away_from_welcome_state_leaves_no_ghost_session_row(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Click project switch from welcome state → NO row created in original project.

    Asserts the original project's session-list count is unchanged after the visit.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-3")
@pytest.mark.happy_path
def test_clicking_existing_session_from_welcome_state_cancels_new_session_intent(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """session_active_no_messages → resuming_session via session_clicked; no row created."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-3; composer-state preservation across error_recoverable")
@pytest.mark.error_path
def test_transient_create_session_failure_preserves_composer_text_across_retry(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """create_session 503 → error_recoverable; composer text "Show me top customers" preserved on retry."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-3; un-skip when harness.j002.start_new_session + send_first_message ship")
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_drives_new_session_lifecycle_end_to_end(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """harness.j002.start_new_session + send_first_message; session title == first message."""
    pytest.fail("not yet implemented")
