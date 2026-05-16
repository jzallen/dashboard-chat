"""US-209 — Dataset context switches via agent's resolve_dataset path AND
direct selection; cross-tenant rejected with prior scope preserved;
concurrent picks serialize via XState semantics.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-209-dataset-context-switching.feature`

MR-5. Validates IC-J002-5. Depends on MR-2's Migration 012 + MR-4's
X-Active-Scope writer contract.

Port-to-port: every scenario drives the real local compose stack through
the user-facing ingress (auth-proxy `/ui-state/flow/session-chat/event`)
and observes via the session-chat projection — the same SSOT the FE reads.
The dataset pick flows `session_active --dataset_resolved_by_agent /
dataset_picked_directly--> switching_dataset_context --> session_active`.
"""

from __future__ import annotations

import json
import subprocess
import time
import uuid

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_5,
    pytest.mark.needs_compose_stack,
]

DEV_PRINCIPAL_ID = "dev-user-001"
DEV_ORG_ID = "dev-org-001"
SESSION_CHAT_FLOW_ID = f"session-chat:{DEV_PRINCIPAL_ID}"


# ───────────────────────────── dev backend seeding ─────────────────────────────


def _api_curl(method: str, path: str, body: dict | None = None,
              org_id: str = DEV_ORG_ID) -> str:
    args = [
        "docker", "exec", "dashboard-api", "curl", "-sS",
        "-X", method, f"http://localhost:8000{path}",
        "-H", f"x-user-id: {DEV_PRINCIPAL_ID}",
        "-H", f"x-org-id: {org_id}",
        "-H", "x-user-email: dev@localhost",
    ]
    if body is not None:
        args += ["-H", "content-type: application/json", "-d", json.dumps(body)]
    return subprocess.run(
        args, capture_output=True, text=True, timeout=10, check=True
    ).stdout


def _create_project(name: str) -> str:
    body = json.loads(_api_curl("POST", "/api/projects", {"name": name}))
    return body["data"]["id"]


def _create_session(project_id: str, title: str = "Chat") -> str:
    body = json.loads(
        _api_curl("POST", f"/api/projects/{project_id}/sessions", {"title": title})
    )
    return body["data"]["id"] if "data" in body else body["id"]


def _create_dataset(project_id: str, name: str) -> str:
    """Seed a dataset row directly via the API container's SQLite."""
    dataset_id = str(uuid.uuid4())
    sql = (
        f"import sqlite3; conn=sqlite3.connect('/data/app.db'); "
        f"conn.execute(\"INSERT INTO datasets (id, project_id, name, schema_config, "
        f"partition_fields, created_at, updated_at) VALUES "
        f"('{dataset_id}', '{project_id}', '{name}', '{{}}', '[]', "
        f"'2026-05-15', '2026-05-15')\"); conn.commit(); print('inserted')"
    )
    proc = subprocess.run(
        ["docker", "exec", "dashboard-api", "python", "-c", sql],
        capture_output=True, text=True, timeout=10, check=True,
    )
    assert "inserted" in proc.stdout, proc.stderr
    return dataset_id


def _create_cross_tenant_dataset(name: str) -> str:
    """Seed a project owned by a DIFFERENT org + a dataset under it. A dev
    principal hitting `GET /api/datasets/:id` gets 403 (ScopeResolver
    invariant 4 — cross-tenant) because the dataset's project.org_id !=
    dev-org-001."""
    foreign_project_id = str(uuid.uuid4())
    dataset_id = str(uuid.uuid4())
    sql = (
        f"import sqlite3; conn=sqlite3.connect('/data/app.db'); "
        f"conn.execute(\"INSERT INTO projects (id, name, org_id, created_by, "
        f"created_at, updated_at) VALUES ('{foreign_project_id}', 'Foreign Proj', "
        f"'other-org-999', 'other-user', '2026-05-15', '2026-05-15')\"); "
        f"conn.execute(\"INSERT INTO datasets (id, project_id, name, schema_config, "
        f"partition_fields, created_at, updated_at) VALUES "
        f"('{dataset_id}', '{foreign_project_id}', '{name}', '{{}}', '[]', "
        f"'2026-05-15', '2026-05-15')\"); conn.commit(); print('inserted')"
    )
    proc = subprocess.run(
        ["docker", "exec", "dashboard-api", "python", "-c", sql],
        capture_output=True, text=True, timeout=10, check=True,
    )
    assert "inserted" in proc.stdout, proc.stderr
    return dataset_id


def _set_session_dataset(project_id: str, session_id: str, dataset_id: str) -> None:
    _api_curl(
        "PATCH",
        f"/api/projects/{project_id}/sessions/{session_id}",
        {"active_dataset_id": dataset_id},
    )


def _persisted_active_dataset_id(session_id: str) -> str | None:
    """Read session.active_dataset_id straight from the backend (the
    persistence SSOT) — proves the PATCH the actor issued landed."""
    body = json.loads(_api_curl("GET", f"/api/sessions/{session_id}"))
    data = body.get("data", body)
    attrs = data.get("attributes", data)
    return attrs.get("active_dataset_id")


# ───────────────────────────── flow helpers ─────────────────────────────


def _sc_projection(driver: J002Driver) -> dict:
    probe = driver.get(
        f"/ui-state/flow/session-chat/projection?flow_id={SESSION_CHAT_FLOW_ID}",
        base=driver.auth_proxy_url,
    )
    return json.loads(probe.body) if probe.status == 200 else {}


def _spawn_and_reach_session_active(driver: J002Driver, session_id: str) -> dict:
    """Spawn J-002, wait for session-chat session_list_loaded, resume the
    session, settle in session_active. Returns the final projection.

    Reset the session-chat flow FIRST (force_restart wipes its event log)
    so each scenario is hermetic — the J-002 flows are keyed by the shared
    `dev-user-001` principal, so a prior scenario's settled session-chat
    state would otherwise bleed across (the project-context `/begin`
    force_restart only resets ITS own flow log, not session-chat's).
    """
    sc_reset = driver.post(
        "/ui-state/flow/session-chat/begin",
        base=driver.auth_proxy_url,
        json_body={"persona_display_name": "Maya Chen", "principal_id": DEV_PRINCIPAL_ID},
    )
    assert sc_reset.status == 200, f"sc begin {sc_reset.status}: {sc_reset.body[:200]}"
    begin = driver.post(
        "/ui-state/flow/project-and-chat-session-management/begin",
        base=driver.auth_proxy_url,
        json_body={"persona_display_name": "Maya Chen", "principal_id": DEV_PRINCIPAL_ID},
    )
    assert begin.status == 200, f"begin returned {begin.status}: {begin.body[:300]}"
    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        if _sc_projection(driver).get("state") == "session_list_loaded":
            break
        time.sleep(0.05)
    else:
        pytest.fail("session-chat never reached session_list_loaded")
    driver.post(
        "/ui-state/flow/session-chat/event",
        base=driver.auth_proxy_url,
        json_body={
            "flow_id": SESSION_CHAT_FLOW_ID,
            "type": "session_clicked",
            "payload": {"session_id": session_id},
        },
    )
    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        data = _sc_projection(driver)
        if data.get("state") == "session_active":
            return data
        time.sleep(0.05)
    pytest.fail("session-chat never reached session_active after resume")


def _send_dataset_event(
    driver: J002Driver, event_type: str, dataset_id: str
) -> dict:
    """Send a dataset pick event to session-chat; poll until it re-settles
    (XState single-event-at-a-time means `send()` awaits the
    switchDatasetContext invoke — the projection it returns is settled)."""
    driver.post(
        "/ui-state/flow/session-chat/event",
        base=driver.auth_proxy_url,
        json_body={
            "flow_id": SESSION_CHAT_FLOW_ID,
            "type": event_type,
            "payload": {"resource_id": dataset_id, "resource_type": "dataset"},
        },
    )
    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        data = _sc_projection(driver)
        if data.get("state") == "session_active":
            return data
        time.sleep(0.05)
    pytest.fail("session-chat never re-settled in session_active after dataset event")


# ─────────────────────────────── Scenarios ───────────────────────────────


@pytest.mark.happy_path
def test_agent_resolve_dataset_then_user_pick_switches_scope_and_persists(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """resolve_dataset → data-agent-request → user pick → switching_dataset_context →
    session_active with resource_id set; session.active_dataset_id persisted."""
    proj_id = _create_project("Q4 Analytics")
    ds_id = _create_dataset(proj_id, "patients_2025")
    session_id = _create_session(proj_id, "Patients chat")

    final = _spawn_and_reach_session_active(driver, session_id)
    # Precondition: no dataset attached.
    assert (final["context"].get("resource") or {}).get("id") is None

    final = _send_dataset_event(driver, "dataset_resolved_by_agent", ds_id)

    assert final["state"] == "session_active"
    scope = final.get("active_scope") or {}
    assert scope.get("resource_type") == "dataset" and scope.get("resource_id") == ds_id, (
        f"US-209 #1: active_scope must reflect patients_2025; got {scope!r}"
    )
    resource = final["context"].get("resource") or {}
    assert resource.get("type") == "dataset" and resource.get("id") == ds_id
    # session.active_dataset_id persisted to the backend (DWD-2 storage SSOT).
    assert _persisted_active_dataset_id(session_id) == ds_id, (
        "US-209 #1: session.active_dataset_id must be persisted"
    )


@pytest.mark.happy_path
def test_resubmitted_chat_turn_carries_new_x_active_scope_after_dataset_attaches(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Post-dataset-attach: the projection's active_scope carries resource_*;
    a re-submitted chat turn carrying that X-Active-Scope is accepted + the
    agent dispatches against the resolved dataset."""
    proj_id = _create_project("Q4 Analytics")
    ds_id = _create_dataset(proj_id, "patients_2025")
    session_id = _create_session(proj_id, "Patients chat")
    _spawn_and_reach_session_active(driver, session_id)
    final = _send_dataset_event(driver, "dataset_resolved_by_agent", ds_id)

    scope = final.get("active_scope") or {}
    assert scope.get("resource_type") == "dataset" and scope.get("resource_id") == ds_id
    # The FE re-submits the original chat turn carrying the new X-Active-Scope
    # (US-208's writer contract). The agent must accept it and dispatch.
    probe = driver.post_agent_chat(
        bearer=driver.mint_dev_jwt(),
        active_scope={
            "org_id": DEV_ORG_ID,
            "project_id": proj_id,
            "resource_type": "dataset",
            "resource_id": ds_id,
        },
        body={
            "messages": [{"role": "user", "content": "filter rows where age > 30"}],
            "thread_id": session_id,
        },
    )
    assert probe.status == 200, (
        f"US-209 #2: re-submitted turn with new X-Active-Scope must be accepted; "
        f"got {probe.status}: {probe.body[:300]}"
    )


@pytest.mark.happy_path
def test_direct_dataset_selection_updates_active_scope_and_persists(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """dataset_picked_directly → switching_dataset_context → session_active;
    active_scope retargeted + session.active_dataset_id updated."""
    proj_id = _create_project("Q4 Analytics")
    prior_ds = _create_dataset(proj_id, "sales_2026")
    new_ds = _create_dataset(proj_id, "customers_2025")
    session_id = _create_session(proj_id, "Sales chat")
    _set_session_dataset(proj_id, session_id, prior_ds)

    final = _spawn_and_reach_session_active(driver, session_id)
    # Precondition: the prior dataset is the active scope (resume restored it).
    assert (final["context"].get("resource") or {}).get("id") == prior_ds

    final = _send_dataset_event(driver, "dataset_picked_directly", new_ds)

    assert final["state"] == "session_active"
    scope = final.get("active_scope") or {}
    assert scope.get("resource_id") == new_ds, (
        f"US-209 #3: active_scope.resource_id must be customers_2025; got {scope!r}"
    )
    assert _persisted_active_dataset_id(session_id) == new_ds, (
        "US-209 #3: session.active_dataset_id must be updated to customers_2025"
    )


@pytest.mark.error_path
def test_cross_tenant_dataset_pick_rejected_with_prior_scope_preserved(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Cross-tenant pick → switching_dataset_context → session_active with
    prior resource_id UNCHANGED; underlying_cause_tag=dataset_access_denied;
    session.active_dataset_id NOT updated."""
    proj_id = _create_project("Q4 Analytics")
    prior_ds = _create_dataset(proj_id, "sales_2026")
    restricted_ds = _create_cross_tenant_dataset("restricted_dataset")
    session_id = _create_session(proj_id, "Sales chat")
    _set_session_dataset(proj_id, session_id, prior_ds)

    final = _spawn_and_reach_session_active(driver, session_id)
    assert (final["context"].get("resource") or {}).get("id") == prior_ds

    final = _send_dataset_event(driver, "dataset_picked_directly", restricted_ds)

    assert final["state"] == "session_active", (
        f"US-209 #4: J-002 returns to session_active (graceful); got {final['state']!r}"
    )
    ctx = final["context"]
    resource = ctx.get("resource") or {}
    assert resource.get("id") == prior_ds, (
        f"US-209 #4: prior scope MUST be preserved (sales_2026); got {resource!r}"
    )
    assert ctx.get("underlying_cause_tag") == "dataset_access_denied", (
        f"US-209 #4: named diagnostic must surface; got {ctx.get('underlying_cause_tag')!r}"
    )
    scope = final.get("active_scope") or {}
    assert scope.get("resource_id") == prior_ds, (
        f"US-209 #4: active_scope.resource_id still sales_2026; got {scope!r}"
    )
    # session.active_dataset_id was NOT written (still the prior dataset).
    assert _persisted_active_dataset_id(session_id) == prior_ds, (
        "US-209 #4: a rejected pick must NOT update session.active_dataset_id"
    )


@pytest.mark.boundary
@pytest.mark.property
def test_concurrent_dataset_picks_serialize_via_xstate_semantics_most_recent_wins(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Two dataset_resolved_by_agent events in rapid succession → serial
    processing (XState single-event-at-a-time, orchestrator awaits each
    settle); final session.active_dataset_id == most-recent pick."""
    proj_id = _create_project("Q4 Analytics")
    ds_first = _create_dataset(proj_id, "first_pick")
    ds_second = _create_dataset(proj_id, "second_pick")
    session_id = _create_session(proj_id, "Race chat")
    _spawn_and_reach_session_active(driver, session_id)

    # Fire both without waiting between them; the orchestrator serialises
    # each `send()` by awaiting waitForSettledState (switching_dataset_context
    # is transient), so the most-recent pick is the final resource.
    for ds in (ds_first, ds_second):
        driver.post(
            "/ui-state/flow/session-chat/event",
            base=driver.auth_proxy_url,
            json_body={
                "flow_id": SESSION_CHAT_FLOW_ID,
                "type": "dataset_resolved_by_agent",
                "payload": {"resource_id": ds, "resource_type": "dataset"},
            },
        )

    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        data = _sc_projection(driver)
        if (
            data.get("state") == "session_active"
            and (data["context"].get("resource") or {}).get("id") == ds_second
        ):
            break
        time.sleep(0.05)
    else:
        pytest.fail("concurrent picks did not converge on the most-recent dataset")

    scope = _sc_projection(driver).get("active_scope") or {}
    assert scope.get("resource_id") == ds_second, (
        f"US-209 #5: most-recent pick must win; got {scope!r}"
    )
    assert _persisted_active_dataset_id(session_id) == ds_second, (
        "US-209 #5: session.active_dataset_id == most-recent pick"
    )


@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_drives_both_attach_paths_and_asserts_scope(
    requires_compose_stack: None,
    requires_ts_harness: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """harness.j002.attach_dataset_via_agent + attach_dataset_directly +
    assert_scope drive both US-209 paths end-to-end through the TS harness."""
    proj_id = _create_project("Q4 Analytics")
    ds_agent = _create_dataset(proj_id, "patients_2025")
    ds_direct = _create_dataset(proj_id, "customers_2025")
    session_id = _create_session(proj_id, "Harness chat")
    _spawn_and_reach_session_active(driver, session_id)

    script = (
        "import { userFlowHarness } from './harness/user-flow-harness.ts';\n"
        "const h = userFlowHarness({\n"
        f"  authProxyUrl: '{driver.auth_proxy_url}',\n"
        "  fakeWorkOSUrl: 'http://localhost:14299',\n"
        f"  principalId: '{DEV_PRINCIPAL_ID}',\n"
        "});\n"
        f"await h.j002.attach_dataset_via_agent('patients_2025');\n"
        f"await h.j002.assert_scope({{ resource_type: 'dataset', resource_id: '{ds_agent}' }});\n"
        f"await h.j002.attach_dataset_directly('{ds_direct}');\n"
        f"await h.j002.assert_scope({{ resource_type: 'dataset', resource_id: '{ds_direct}' }});\n"
        "console.log(JSON.stringify({ ok: true }));\n"
    )
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=str(driver.repo_root / "tests" / "acceptance" / "user-flow-state-machines"),
        capture_output=True, text=True, timeout=45, check=False,
        env={"PATH": __import__("os").environ.get("PATH", "")},
    )
    assert result.returncode == 0, (
        f"harness.j002 attach-dataset contract failed (exit {result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    out = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "{}"
    assert json.loads(out).get("ok") is True
