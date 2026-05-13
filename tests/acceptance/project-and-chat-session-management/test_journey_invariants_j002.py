"""Cross-cutting integration checkpoints IC-J002-1 through IC-J002-7.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/journey-invariants-j002.feature`

These are property invariants — they hold across every J-002 transition
that crosses the stated boundary, regardless of which user story
exercises it. Per the J-001 pattern, the property tags are
`pytest.mark.property` and DELIVER may upgrade individual scenarios to
true property-based shapes via hypothesis if the team prefers
(architecture-level decision left open per nw-distill skill).

The Praxis F-5 deferred scenario (review §3 F-5) is encoded here as a
sub-scenario of IC-J002-1: `context.org_id` MUST equal JWT decoded
`org_id` AND J-001 projection `active_scope.org_id` at the same
sequence_id boundary (within 100ms for clock skew).

Per-IC MR placement (un-skip schedule) follows the per-MR scope:
  - IC-J002-1 (+ Praxis F-5): MR-1 (entry from J-001 ready)
  - IC-J002-2: MR-1 (project_selected entry contract)
  - IC-J002-3: MR-2 (resuming_session atomic materialization)
  - IC-J002-4: MR-4 (switching_project invalidation contract)
  - IC-J002-5: MR-5 (dataset_resolved_by_agent → exactly-one scope update)
  - IC-J002-6: MR-6 (FREEZE/THAW pause + replay contract)
  - IC-J002-7: MR-4 (chat-turn header invariant)
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.property,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.skip(
    reason=(
        "DELIVER-deferred to MR-1 — PRAXIS F-5 deferred property. Per the system-"
        "designer review §3 F-5 and DD-5 in distill/wave-decisions.md: J-002's "
        "context.org_id at resolving_initial_scope entry equals the JWT's decoded "
        "org_id claim AND equals the J-001 projection's active_scope.org_id at "
        "the same sequence_id boundary (within 100ms for clock skew). Future "
        "J-NNN flows whose machine context carries org_id MUST also satisfy this."
    )
)
@pytest.mark.mr_1
@pytest.mark.praxis_f5
def test_ic_j002_1_entry_from_j001_ready_reads_org_id_from_j001_projection(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """IC-J002-1 + Praxis F-5: org_id consistency across J-001 ↔ J-002 ↔ JWT.

    On entry to `resolving_initial_scope`:
      1. J-002.context.org_id == J-001.projection.active_scope.org_id at same sequence_id (±100ms)
      2. J-002.context.org_id == JWT.decoded.org_id
      3. NO separate /api/orgs/me or JWT-decode fetch is observed in the request log
    """
    pytest.fail("not yet implemented — IC-J002-1 + Praxis F-5 property")


@pytest.mark.mr_1
def test_ic_j002_2_project_selected_entry_has_non_null_authorized_project_id(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """IC-J002-2: on project_selected entry, active_scope.project_id non-null AND user-authorized.

    Cross-tenant rejection happens BEFORE entry (via scope_mismatch_terminal),
    NOT after — no observation of project_selected with a project the user
    cannot access.
    """
    import json
    import subprocess
    import time
    import uuid

    DEV_PRINCIPAL_ID = "dev-user-001"
    J002_FLOW_ID = f"project-and-chat-session-management:{DEV_PRINCIPAL_ID}"

    # Spawn J-002 directly — same orchestrator method the j001_ready
    # broadcast hook calls in production (see DWD-6 + the orchestrator's
    # `j001_ready_hook` block).
    begin = driver.post(
        "/ui-state/flow/project-and-chat-session-management/begin",
        base=driver.auth_proxy_url,
        json_body={"persona_display_name": "Maya Chen"},
    )
    assert begin.status == 200, (
        f"J-002 begin expected 200; got {begin.status} body={begin.body[:200]!r}"
    )

    # Poll J-002 → no_projects_empty_state.
    def wait_for_state(target: str, timeout_s: float = 5.0) -> dict:
        deadline = time.monotonic() + timeout_s
        last = None
        while time.monotonic() < deadline:
            probe = driver.get_j002_projection(
                flow_id=J002_FLOW_ID,
                base=driver.auth_proxy_url,
            )
            last = probe
            if driver.projection_state(probe) == target:
                return json.loads(probe.body)
            time.sleep(0.05)
        assert last is not None
        pytest.fail(
            f"J-002 never reached {target!r}; final={driver.projection_state(last)!r}"
        )

    wait_for_state("no_projects_empty_state")

    # Create a project — this drives the machine through `creating_project`
    # to `project_selected`.
    project_name = f"Q4 Analytics {uuid.uuid4().hex[:8]}"
    create = driver.post(
        "/ui-state/flow/project-and-chat-session-management/event",
        base=driver.auth_proxy_url,
        json_body={
            "flow_id": J002_FLOW_ID,
            "type": "create_project_submitted",
            "payload": {"org_name": project_name},
        },
    )
    assert create.status == 200

    body = wait_for_state("project_selected")

    # IC-J002-2 invariant 1: active_scope.project_id is non-null on entry.
    project_id = body["active_scope"]["project_id"]
    assert project_id is not None and project_id != "", (
        f"IC-J002-2: project_selected entry MUST have non-null "
        f"active_scope.project_id; got {project_id!r}"
    )

    # IC-J002-2 invariant 2: the project_id belongs to the user's org.
    # Assert by direct backend call (auth-proxy gates /api behind real JWT;
    # the J-002 actor's createProject succeeded with the user's identity
    # headers, so we round-trip via the same identity to verify the row).
    auth_check = subprocess.run(
        [
            "docker", "exec", "dashboard-api", "curl", "-s", "-o", "/dev/null",
            "-w", "%{http_code}",
            f"http://localhost:8000/api/projects/{project_id}",
            "-H", "x-user-id: dev-user-001",
            "-H", "x-org-id: dev-org-001",
            "-H", "x-user-email: dev@localhost",
        ],
        capture_output=True, text=True, timeout=10,
    )
    assert auth_check.stdout.strip() == "200", (
        f"IC-J002-2: project_selected entry has project_id={project_id!r} "
        f"that the user is NOT authorized for — got HTTP {auth_check.stdout.strip()!r} "
        f"from /api/projects/{project_id}"
    )


@pytest.mark.skip(reason="DELIVER-deferred to MR-2; atomic materialization through resuming_session")
@pytest.mark.mr_2
def test_ic_j002_3_resuming_session_to_session_active_materializes_atomically(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """IC-J002-3: transcript AND active_scope.resource_* both visible on session_active entry.

    NO observation of session_active with mixed/partial state (transcript
    present but resource still resolving, or vice versa).
    """
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; switching_project invalidation contract — load-bearing for K-J002-4")
@pytest.mark.mr_4
def test_ic_j002_4_switching_project_invalidates_session_and_resource_before_new_load(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """IC-J002-4: on switching_project entry, session_id null AND resource_* cleared
    BEFORE the new project's loading_session_list fires; the agent receives no
    further turns from the old chat-view instance during the switch window."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-5; dataset_resolved_by_agent contract")
@pytest.mark.mr_5
def test_ic_j002_5_dataset_resolved_by_agent_produces_exactly_one_scope_update(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """IC-J002-5: dataset_resolved_by_agent → exactly ONE active_scope.resource_* update
    via the projection; the agent's NEXT turn sees the new resource_id; session
    metadata is updated BEFORE the next turn dispatches."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-6; FREEZE pause contract")
@pytest.mark.mr_6
def test_ic_j002_6_freeze_pauses_outgoing_mutations_intents_queue_replay_on_thaw(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """IC-J002-6: on FREEZE, J-002 emits no backend POSTs / projection writes /
    agent turns; intents queue at orchestrator with original correlation refs;
    on THAW, intents replay against live state."""
    pytest.fail("not yet implemented")


@pytest.mark.skip(reason="DELIVER-deferred to MR-4; X-Active-Scope header invariant")
@pytest.mark.mr_4
def test_ic_j002_7_every_chat_turn_from_j002_state_carries_x_active_scope_header(
    requires_compose_stack: None,
    driver: J002Driver,
) -> None:
    """IC-J002-7: every chat turn originating in session_active or
    session_active_no_messages (post-first_message_sent) carries X-Active-Scope
    with org_id AND project_id; agent rejects missing fields with 400 + named
    diagnostic. Parameterized over both chat-turn-emitting J-002 states."""
    pytest.fail("not yet implemented")
