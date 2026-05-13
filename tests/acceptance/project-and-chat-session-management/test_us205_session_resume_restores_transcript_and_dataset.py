"""US-205 — Resume restores BOTH transcript AND dataset chip atomically;
deleted-dataset case degrades gracefully; non-existent session returns
silently to the session list.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-205-session-resume-restores-transcript-and-dataset.feature`

MR-2 dependency: Alembic migration 009 (DWD-2) adds `active_dataset_id`
to the session row. Migration must land BEFORE these tests un-skip.
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_2,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(reason="DELIVER-deferred to MR-2; un-skip when Migration 009 + resuming_session land")
@pytest.mark.happy_path
def test_resuming_session_restores_transcript_and_dataset_chip_on_same_first_paint(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """IC-J002-3: transcript AND active_scope.resource_* both visible on first paint.

    Atomically — no transient observation of session_active with transcript
    present but resource still resolving.
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-2")
@pytest.mark.happy_path
def test_resuming_session_with_null_dataset_enters_conversational_mode(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """active_dataset_id = NULL → session_active with no resource_id; conversational mode."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-2; graceful-degradation path")
@pytest.mark.degraded
def test_resuming_session_with_deleted_dataset_degrades_gracefully_to_conversational(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Stored active_dataset_id 404s → session_active, resource_* null, session_dataset_unavailable emitted."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-2")
@pytest.mark.error_path
def test_resuming_nonexistent_session_returns_silently_to_session_list_visible(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Click a deleted session → silent return to session_list_visible (no panel)."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-2; un-skip when harness.j002.resume_session + get_transcript ship")
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_asserts_resume_contract(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """`harness.j002.resume_session` + assert_session_active + assert_scope + get_transcript."""
    pytest.fail("not yet implemented")
