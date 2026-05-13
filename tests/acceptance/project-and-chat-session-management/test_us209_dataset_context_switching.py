"""US-209 — Dataset context switches via agent's resolve_dataset path AND
direct selection; cross-tenant rejected with prior scope preserved;
concurrent picks serialize via XState semantics.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-209-dataset-context-switching.feature`

MR-5. Validates IC-J002-5. Depends on MR-2's Migration 009 + MR-4's
X-Active-Scope writer contract.
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_5,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(reason="DELIVER-deferred to MR-5; agent's resolve_dataset → switching_dataset_context path")
@pytest.mark.happy_path
def test_agent_resolve_dataset_then_user_pick_switches_scope_and_persists(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """resolve_dataset → data-agent-request → user pick → switching_dataset_context →
    session_active with resource_id set; session.active_dataset_id persisted."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-5; re-submission contract for resolve_dataset loop")
@pytest.mark.happy_path
def test_resubmitted_chat_turn_carries_new_x_active_scope_after_dataset_attaches(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Post-dataset-attach: next chat turn carries X-Active-Scope with resource_*."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-5; direct selection path")
@pytest.mark.happy_path
def test_direct_dataset_selection_updates_active_scope_and_persists(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """dataset_picked_directly → switching_dataset_context → session_active; persist."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-5; ScopeResolver invariant 4 graceful-degradation")
@pytest.mark.error_path
def test_cross_tenant_dataset_pick_rejected_with_prior_scope_preserved(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Cross-tenant pick → switching_dataset_context → session_active with prior resource_id unchanged;
    inline gutter copy "you don't have access to that dataset"; active_dataset_id NOT updated."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-5; XState single-event-at-a-time serialization")
@pytest.mark.boundary
@pytest.mark.property
def test_concurrent_dataset_picks_serialize_via_xstate_semantics_most_recent_wins(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Two dataset_resolved_by_agent events in rapid succession → serial processing;
    final session.active_dataset_id == most-recent pick."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-5; un-skip when harness.j002.attach_dataset_* ships")
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_drives_both_attach_paths_and_asserts_scope(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """attach_dataset_via_agent + attach_dataset_directly + assert_scope."""
    pytest.fail("not yet implemented")
