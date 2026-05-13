"""US-205 — Resume restores BOTH transcript AND dataset chip atomically;
deleted-dataset case degrades gracefully; non-existent session returns
silently to the session list.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-205-session-resume-restores-transcript-and-dataset.feature`

MR-2 dependency: Alembic migration 012 (DWD-2) adds `active_dataset_id`
to the session row. Migration landed in MR-2a (b496fe6). The serialization
(mapper + GET endpoint) lands as part of MR-2 substrate completion.
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
    pytest.mark.mr_2,
    pytest.mark.needs_compose_stack,
]

DEV_PRINCIPAL_ID = "dev-user-001"
PROJECT_FLOW_ID = f"project-and-chat-session-management:{DEV_PRINCIPAL_ID}"
SESSION_CHAT_FLOW_ID = f"session-chat:{DEV_PRINCIPAL_ID}"


# ─────────────────────────── Helper: dev backend seeding ───────────────────────────


def _create_project(name: str) -> str:
    proc = subprocess.run(
        [
            "docker", "exec", "dashboard-api", "curl", "-sS",
            "-X", "POST",
            "http://localhost:8000/api/projects",
            "-H", "x-user-id: dev-user-001",
            "-H", "x-org-id: dev-org-001",
            "-H", "x-user-email: dev@localhost",
            "-H", "content-type: application/json",
            "-d", json.dumps({"name": name}),
        ],
        capture_output=True, text=True, timeout=10, check=True,
    )
    body = json.loads(proc.stdout)
    return body["data"]["id"]


def _create_session(project_id: str, title: str = "Chat") -> str:
    proc = subprocess.run(
        [
            "docker", "exec", "dashboard-api", "curl", "-sS",
            "-X", "POST",
            f"http://localhost:8000/api/projects/{project_id}/sessions",
            "-H", "x-user-id: dev-user-001",
            "-H", "x-org-id: dev-org-001",
            "-H", "x-user-email: dev@localhost",
            "-H", "content-type: application/json",
            "-d", json.dumps({"title": title}),
        ],
        capture_output=True, text=True, timeout=10, check=True,
    )
    body = json.loads(proc.stdout)
    return body["data"]["id"] if "data" in body else body["id"]


def _create_dataset(project_id: str, name: str = "Sales Data") -> str:
    """Seed a dataset row directly via the API's SQLite (no upload flow).
    Returns the dataset id."""
    dataset_id = str(uuid.uuid4())
    sql = (
        f"import sqlite3; conn=sqlite3.connect('/data/app.db'); "
        f"conn.execute(\"INSERT INTO datasets (id, project_id, name, schema_config, "
        f"partition_fields, created_at, updated_at) VALUES "
        f"('{dataset_id}', '{project_id}', '{name}', '{{}}', '[]', "
        f"'2026-05-13', '2026-05-13')\"); conn.commit(); print('inserted')"
    )
    proc = subprocess.run(
        ["docker", "exec", "dashboard-api", "python", "-c", sql],
        capture_output=True, text=True, timeout=10, check=True,
    )
    assert "inserted" in proc.stdout
    return dataset_id


def _set_session_dataset(project_id: str, session_id: str, dataset_id: str | None) -> None:
    """PATCH the session's active_dataset_id via the backend's update_session endpoint."""
    body = {"active_dataset_id": dataset_id}
    subprocess.run(
        [
            "docker", "exec", "dashboard-api", "curl", "-sS",
            "-X", "PATCH",
            f"http://localhost:8000/api/projects/{project_id}/sessions/{session_id}",
            "-H", "x-user-id: dev-user-001",
            "-H", "x-org-id: dev-org-001",
            "-H", "x-user-email: dev@localhost",
            "-H", "content-type: application/json",
            "-d", json.dumps(body),
        ],
        capture_output=True, text=True, timeout=10, check=True,
    )


def _spawn_j002_and_wait_session_list(driver: J002Driver) -> None:
    """Spawn J-002 + wait for session-chat to reach session_list_visible."""
    begin = driver.post(
        "/ui-state/flow/project-and-chat-session-management/begin",
        base=driver.auth_proxy_url,
        json_body={"persona_display_name": "Maya Chen"},
    )
    assert begin.status == 200
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        probe = driver.get(
            f"/ui-state/flow/session-chat/projection?flow_id={SESSION_CHAT_FLOW_ID}",
            base=driver.auth_proxy_url,
        )
        data = json.loads(probe.body) if probe.status == 200 else {}
        if data.get("state") == "session_list_visible":
            return
        time.sleep(0.05)
    pytest.fail("session-chat never reached session_list_visible")


def _resume_session(driver: J002Driver, session_id: str) -> dict:
    """Send session_clicked to session-chat. Returns the final projection."""
    driver.post(
        "/ui-state/flow/session-chat/event",
        base=driver.auth_proxy_url,
        json_body={
            "flow_id": SESSION_CHAT_FLOW_ID,
            "type": "session_clicked",
            "payload": {"session_id": session_id},
        },
    )
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        probe = driver.get(
            f"/ui-state/flow/session-chat/projection?flow_id={SESSION_CHAT_FLOW_ID}",
            base=driver.auth_proxy_url,
        )
        data = json.loads(probe.body) if probe.status == 200 else {}
        state = data.get("state")
        # Settle in session_active OR back to session_list_visible (silent-not-found).
        if state in ("session_active", "session_list_visible"):
            return data
        if state == "error_recoverable":
            return data
        time.sleep(0.05)
    pytest.fail("session-chat never settled after session_clicked")


# ─────────────────────────── Scenarios ───────────────────────────


@pytest.mark.happy_path
def test_resuming_session_restores_transcript_and_dataset_chip_on_same_first_paint(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """IC-J002-3: transcript AND active_scope.resource_* both visible on first paint.

    Atomically — no transient observation of session_active with transcript
    present but resource still resolving (the materialization is a single
    XState assign per DESIGN §2.3.B).
    """
    proj_id = _create_project("Q4 Analytics")
    dataset_id = _create_dataset(proj_id, "Sales 2026")
    session_id = _create_session(proj_id, "Sales chat")
    _set_session_dataset(proj_id, session_id, dataset_id)

    _spawn_j002_and_wait_session_list(driver)
    final = _resume_session(driver, session_id)

    assert final["state"] == "session_active", (
        f"US-205 #1: expected session_active; got {final['state']!r}"
    )
    ctx = final["context"]
    assert ctx.get("session_id") == session_id, (
        f"session_id mismatch: expected {session_id!r}, got {ctx.get('session_id')!r}"
    )
    resource = ctx.get("resource") or {}
    assert resource.get("type") == "dataset" and resource.get("id") == dataset_id, (
        f"US-205 #1: resource should be {{type:dataset,id:{dataset_id!r}}}; got {resource!r}"
    )
    # Transcript field must be present (possibly empty for a fresh session).
    assert isinstance(ctx.get("transcript"), list), (
        f"transcript must be a list; got {type(ctx.get('transcript')).__name__}"
    )
    # active_scope must carry the resource_* fields (DWD-2 read path).
    scope = final.get("active_scope") or {}
    assert scope.get("resource_type") == "dataset" and scope.get("resource_id") == dataset_id, (
        f"US-205 #1: active_scope.resource_* should reflect the dataset; got {scope!r}"
    )


@pytest.mark.happy_path
def test_resuming_session_with_null_dataset_enters_conversational_mode(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """active_dataset_id = NULL → session_active with no resource_id; conversational mode."""
    proj_id = _create_project("Q4 Analytics")
    session_id = _create_session(proj_id, "Conversational chat")
    # No PATCH — active_dataset_id stays null by default.

    _spawn_j002_and_wait_session_list(driver)
    final = _resume_session(driver, session_id)

    assert final["state"] == "session_active"
    ctx = final["context"]
    assert ctx.get("session_id") == session_id
    resource = ctx.get("resource") or {}
    assert resource.get("type") is None and resource.get("id") is None, (
        f"US-205 #2: resource_* must be null; got {resource!r}"
    )
    # `session_dataset_unavailable` flag must NOT be set — null is a valid
    # conversational-mode state, not a graceful-degradation indicator.
    assert ctx.get("session_dataset_unavailable") is False, (
        f"US-205 #2: session_dataset_unavailable must be false for null dataset; "
        f"got {ctx.get('session_dataset_unavailable')!r}"
    )


@pytest.mark.degraded
def test_resuming_session_with_deleted_dataset_degrades_gracefully_to_conversational(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Stored active_dataset_id 404s → session_active, resource_* null,
    session_dataset_unavailable + underlying_cause_tag = dataset_not_found."""
    proj_id = _create_project("Q4 Analytics")
    deleted_dataset_id = str(uuid.uuid4())  # Never inserted → 404 on probe
    session_id = _create_session(proj_id, "Chat with deleted dataset")
    _set_session_dataset(proj_id, session_id, deleted_dataset_id)

    _spawn_j002_and_wait_session_list(driver)
    final = _resume_session(driver, session_id)

    assert final["state"] == "session_active", (
        f"US-205 #3: even a deleted dataset → session_active (graceful); got {final['state']!r}"
    )
    ctx = final["context"]
    resource = ctx.get("resource") or {}
    assert resource.get("type") is None and resource.get("id") is None, (
        f"US-205 #3: deleted dataset → resource_* null; got {resource!r}"
    )
    assert ctx.get("session_dataset_unavailable") is True, (
        f"US-205 #3: session_dataset_unavailable must be True; "
        f"got {ctx.get('session_dataset_unavailable')!r}"
    )
    assert ctx.get("underlying_cause_tag") == "dataset_not_found", (
        f"US-205 #3: underlying_cause_tag must be dataset_not_found; "
        f"got {ctx.get('underlying_cause_tag')!r}"
    )


@pytest.mark.error_path
def test_resuming_nonexistent_session_returns_silently_to_session_list_visible(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Click a deleted session → silent return to session_list_visible (no panel)."""
    proj_id = _create_project("Q4 Analytics")
    # Create a session so the project has memory; then we'll try to resume
    # a DIFFERENT (nonexistent) id.
    _create_session(proj_id, "Existing chat")
    ghost_id = str(uuid.uuid4())

    _spawn_j002_and_wait_session_list(driver)
    final = _resume_session(driver, ghost_id)

    assert final["state"] == "session_list_visible", (
        f"US-205 #4: nonexistent session → silent return to session_list_visible; "
        f"got {final['state']!r}"
    )
    ctx = final["context"]
    # Silent — no underlying_cause_tag surfaced; intent cleared.
    assert ctx.get("underlying_cause_tag") is None, (
        f"US-205 #4: silent return must NOT surface a cause tag; "
        f"got {ctx.get('underlying_cause_tag')!r}"
    )
    assert ctx.get("intent_session_id") is None, (
        f"US-205 #4: intent_session_id must be cleared; got {ctx.get('intent_session_id')!r}"
    )


@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_asserts_resume_contract(
    requires_compose_stack: None,
    requires_ts_harness: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """`harness.j002.resume_session` + assert_session_active + get_transcript end-to-end."""
    proj_id = _create_project("Q4 Analytics")
    dataset_id = _create_dataset(proj_id, "Sales 2026")
    session_id = _create_session(proj_id, "Sales chat")
    _set_session_dataset(proj_id, session_id, dataset_id)

    script = (
        "import { userFlowHarness } from './harness/user-flow-harness.ts';\n"
        "const h = userFlowHarness({\n"
        f"  authProxyUrl: '{driver.auth_proxy_url}',\n"
        "  fakeWorkOSUrl: 'http://localhost:14299',\n"
        f"  principalId: '{DEV_PRINCIPAL_ID}',\n"
        "});\n"
        "await h.j002.begin('Maya Chen');\n"
        "// Wait for session-chat to settle in session_list_visible.\n"
        "for (let i = 0; i < 50; i++) {\n"
        "  const p = await h.j002.get_session_chat_projection();\n"
        "  if (p.state === 'session_list_visible') break;\n"
        "  await new Promise(r => setTimeout(r, 100));\n"
        "}\n"
        f"await h.j002.resume_session('{session_id}');\n"
        "// Wait for session_active.\n"
        "for (let i = 0; i < 50; i++) {\n"
        "  const p = await h.j002.get_session_chat_projection();\n"
        "  if (p.state === 'session_active') break;\n"
        "  await new Promise(r => setTimeout(r, 100));\n"
        "}\n"
        f"await h.j002.assert_session_active('{session_id}');\n"
        "const transcript = await h.j002.get_transcript();\n"
        "console.log(JSON.stringify({ok: true, transcript_len: transcript.length}));\n"
    )
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=str(driver.repo_root / "tests" / "acceptance" / "user-flow-state-machines"),
        capture_output=True, text=True, timeout=30, check=False,
        env={"PATH": __import__("os").environ.get("PATH", "")},
    )
    assert result.returncode == 0, (
        f"harness.j002.resume_session contract failed (exit {result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    out = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "{}"
    body = json.loads(out)
    assert body.get("ok") is True
