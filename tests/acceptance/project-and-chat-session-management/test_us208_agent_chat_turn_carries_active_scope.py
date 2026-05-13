"""US-208 — Every J-002-originating chat turn carries X-Active-Scope from
the projection; agent rejects missing org_id / project_id with 400;
rejects header.org_id != jwt.org_id with 403; falls back to body during
the migration window; compile-time sunset enforces flag removal.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-208-agent-chat-turn-carries-active-scope.feature`

MR-4. Validates IC-J002-7 + DWD-3 contract. The compile-time sunset
scenario is a STARTUP test (the agent's `npm start` fails fast if the
date has passed AND the flag is on).
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_4,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; un-skip when activeScopeHeader writer + extractActiveScope land")
@pytest.mark.happy_path
def test_chat_turn_from_session_active_carries_x_active_scope_with_org_and_project(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """X-Active-Scope.org_id and project_id non-null; equal to FE chips on same paint;
    post-migration body does NOT carry project_id."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4")
@pytest.mark.error_path
def test_agent_rejects_chat_turn_missing_org_id_with_400(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """X-Active-Scope w/o org_id → 400; response body identifies "org_id" as missing; no LLM call."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4")
@pytest.mark.error_path
def test_agent_rejects_chat_turn_missing_project_id_with_400(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """X-Active-Scope w/o project_id → 400; response identifies "project_id" as missing."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; jwt.org_id vs header.org_id parity check (DWD-3 defense in depth)")
@pytest.mark.error_path
def test_agent_rejects_chat_turn_with_org_id_mismatch_to_jwt_with_403(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """JWT org_id != X-Active-Scope.org_id → 403; body names the mismatch."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; un-skip when harness.j002.assert_agent_received_scope ships")
@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_asserts_agent_received_scope_on_every_turn(
    requires_compose_stack: None,
    requires_ts_harness: None,
    driver: J002Driver,
) -> None:
    """Send 5 turns; harness.j002.assert_agent_received_scope(i) for i in [0..5)."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; migration-window backward-compat fallback per DWD-3")
@pytest.mark.degraded
def test_during_migration_window_agent_falls_back_to_body_project_id_with_observability_event(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """SCOPE_HEADER_FALLBACK_ENABLED=true; legacy client w/o header but body.project_id →
    agent proceeds; emits scope_header_fallback_used { calling_client: User-Agent }."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(
    reason=(
        "DELIVER-deferred to MR-4; compile-time sunset check (DWD-3). This is a "
        "STARTUP test — the agent process must fail-fast on `npm start` when the "
        "sunset date has passed AND the flag is still set to 'true'. DELIVER's "
        "test harness mocks Date.now() OR sets SCOPE_HEADER_FALLBACK_SUNSET to a "
        "past date for this scenario."
    )
)
@pytest.mark.error_path
@pytest.mark.boundary
def test_compile_time_sunset_check_fails_agent_startup_after_date_with_flag_on(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """Past sunset + flag=true → agent process fails at module load; HTTP server never binds."""
    pytest.fail("not yet implemented")
