"""US-206 — "+ New Session" produces instant welcome-state with no backend
write; session row is eagerly created on first message; no ghost rows
on navigate-away; transient create-session failure preserves composer
text.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-206-new-session-is-lazily-created-on-first-message.feature`

MR-3. Validates DWD-10 lazy-creation contract. Pure machine extension
(no schema delta).
"""

from __future__ import annotations

import json
import subprocess
import time

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_3,
    pytest.mark.needs_compose_stack,
]

DEV_PRINCIPAL_ID = "dev-user-001"
PROJECT_FLOW_ID = f"project-and-chat-session-management:{DEV_PRINCIPAL_ID}"
SESSION_CHAT_FLOW_ID = f"session-chat:{DEV_PRINCIPAL_ID}"


# ─────────────────────────── Helpers: dev backend seeding ───────────────────────────


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
        ],
        capture_output=True, text=True, timeout=10, check=True,
    )
    body = json.loads(proc.stdout)
    return body["data"]["id"] if "data" in body else body["id"]


def _list_sessions(project_id: str) -> list[dict]:
    proc = subprocess.run(
        [
            "docker", "exec", "dashboard-api", "curl", "-sS",
            f"http://localhost:8000/api/projects/{project_id}/sessions",
            "-H", "x-user-id: dev-user-001",
            "-H", "x-org-id: dev-org-001",
            "-H", "x-user-email: dev@localhost",
        ],
        capture_output=True, text=True, timeout=10, check=True,
    )
    body = json.loads(proc.stdout)
    rows = body.get("data", []) if isinstance(body, dict) else []
    # Tolerate JSON:API and plain shapes.
    out: list[dict] = []
    for row in rows:
        if "attributes" in row:
            out.append({"id": row["id"], **row["attributes"]})
        else:
            out.append(row)
    return out


def _spawn_j002_and_wait_session_list(driver: J002Driver) -> None:
    """Spawn J-002 + wait for session-chat to reach session_list_loaded."""
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
        if data.get("state") == "session_list_loaded":
            return
        time.sleep(0.05)
    pytest.fail("session-chat never reached session_list_loaded")


def _send_session_chat_event(
    driver: J002Driver,
    event_type: str,
    payload: dict | None = None,
    extra_headers: dict[str, str] | None = None,
) -> dict:
    """POST an event to session-chat; return the projection JSON."""
    res = driver.post(
        "/ui-state/flow/session-chat/event",
        base=driver.auth_proxy_url,
        extra_headers=extra_headers,
        json_body={
            "flow_id": SESSION_CHAT_FLOW_ID,
            "type": event_type,
            "payload": payload or {},
        },
    )
    assert res.status == 200, f"expected 200; got {res.status}: {res.body}"
    return json.loads(res.body)


def _wait_for_state(driver: J002Driver, state: str, timeout: float = 5.0) -> dict:
    """Poll session-chat projection until it reaches `state`. Returns projection."""
    deadline = time.monotonic() + timeout
    last: dict = {}
    while time.monotonic() < deadline:
        probe = driver.get(
            f"/ui-state/flow/session-chat/projection?flow_id={SESSION_CHAT_FLOW_ID}",
            base=driver.auth_proxy_url,
        )
        if probe.status == 200:
            last = json.loads(probe.body)
            if last.get("state") == state:
                return last
        time.sleep(0.05)
    pytest.fail(
        f"session-chat never reached {state!r}; last state {last.get('state')!r}; "
        f"ctx keys={list((last.get('context') or {}).keys())}"
    )


# ─────────────────────────── Scenarios ───────────────────────────


@pytest.mark.happy_path
def test_clicking_new_session_lands_in_welcome_state_with_no_backend_write(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """+ New Session → session_welcome; session_id null; NO session row created.

    The backend's session count for the project is unchanged after the click.
    """
    proj_id = _create_project("Q4 Analytics")
    # Seed 4 prior sessions so the count is non-trivial.
    for i in range(4):
        _create_session(proj_id, f"Prior #{i}")
    before = _list_sessions(proj_id)
    assert len(before) == 4

    _spawn_j002_and_wait_session_list(driver)
    final = _send_session_chat_event(driver, "new_session_clicked")

    assert final["state"] == "session_welcome", (
        f"US-206 #1: expected session_welcome; got {final['state']!r}"
    )
    ctx = final["context"]
    assert ctx.get("session_id") is None, (
        f"US-206 #1: session_id must be null in welcome state; got {ctx.get('session_id')!r}"
    )
    after = _list_sessions(proj_id)
    assert len(after) == len(before), (
        f"US-206 #1: backend session count must be unchanged; before={len(before)} after={len(after)}"
    )


@pytest.mark.happy_path
def test_sending_first_message_eagerly_creates_session_with_title_from_message(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """first_message_sent → session_active; session row created with title=first_message[:80]."""
    proj_id = _create_project("Q4 Analytics")
    before = _list_sessions(proj_id)
    assert before == []

    _spawn_j002_and_wait_session_list(driver)
    _send_session_chat_event(driver, "new_session_clicked")
    _wait_for_state(driver, "session_welcome")

    first_message = "Show me top customers by revenue"
    _send_session_chat_event(
        driver,
        "first_message_sent",
        payload={"content": first_message},
    )
    final = _wait_for_state(driver, "session_active")

    ctx = final["context"]
    new_session_id = ctx.get("session_id")
    assert isinstance(new_session_id, str) and len(new_session_id) > 0, (
        f"US-206 #2: session_id must be a non-empty string after eager-create; got {new_session_id!r}"
    )
    after = _list_sessions(proj_id)
    assert len(after) == 1, (
        f"US-206 #2: exactly 1 session row must exist after eager-create; got {len(after)}: {after}"
    )
    row = after[0]
    assert row["id"] == new_session_id, (
        f"US-206 #2: backend row id must equal projection.session_id; "
        f"row.id={row['id']!r} session_id={new_session_id!r}"
    )
    assert row.get("title") == first_message[:80], (
        f"US-206 #2: row.title must equal first_message[:80]; "
        f"got {row.get('title')!r}"
    )


@pytest.mark.boundary
@pytest.mark.happy_path
def test_navigating_away_from_welcome_state_leaves_no_ghost_session_row(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Click project switch from welcome state → NO row created in original project.

    Asserts the original project's session-list count is unchanged after the visit.
    """
    proj_q4 = _create_project("Q4 Analytics")
    proj_q3 = _create_project("Q3 Sales")
    # Seed an existing session in Q4 to make the assertion non-trivial.
    _create_session(proj_q4, "Existing chat")
    before_q4 = _list_sessions(proj_q4)
    assert len(before_q4) == 1

    _spawn_j002_and_wait_session_list(driver)
    _send_session_chat_event(driver, "new_session_clicked")
    _wait_for_state(driver, "session_welcome")

    # Navigate away (project switch) — drive project-context to a different project.
    # Switching project re-broadcasts project_ready to session-chat which
    # re-enters loading_session_list (per machine §session_welcome
    # different-project_id guard).
    driver.post(
        "/ui-state/flow/project-and-chat-session-management/event",
        base=driver.auth_proxy_url,
        json_body={
            "flow_id": PROJECT_FLOW_ID,
            "type": "switching_project_intent",
            "payload": {"project_id": proj_q3, "project_name": "Q3 Sales"},
        },
    )
    # Wait for session-chat to re-enter session_list_loaded for Q3.
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        probe = driver.get(
            f"/ui-state/flow/session-chat/projection?flow_id={SESSION_CHAT_FLOW_ID}",
            base=driver.auth_proxy_url,
        )
        data = json.loads(probe.body) if probe.status == 200 else {}
        if data.get("state") in ("session_list_loaded", "loading_session_list"):
            ctx = data.get("context") or {}
            # Post audit §9 Q3 / MR-H: project identity on the session-chat
            # projection lives on the shared `project: { id, name }` field.
            if (ctx.get("project") or {}).get("id") == proj_q3:
                break
        time.sleep(0.05)

    # Assert Q4's session count is unchanged — no ghost row was created.
    after_q4 = _list_sessions(proj_q4)
    assert len(after_q4) == len(before_q4), (
        f"US-206 #3: Q4 session list must be unchanged after welcome-state navigate-away; "
        f"before={len(before_q4)} after={len(after_q4)}"
    )


@pytest.mark.happy_path
def test_clicking_existing_session_from_welcome_state_cancels_new_session_intent(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """session_welcome → resuming_session via session_clicked; no row created."""
    proj_id = _create_project("Q4 Analytics")
    existing_id = _create_session(proj_id, "chat-9b2a")
    before = _list_sessions(proj_id)
    assert len(before) == 1

    _spawn_j002_and_wait_session_list(driver)
    _send_session_chat_event(driver, "new_session_clicked")
    _wait_for_state(driver, "session_welcome")

    _send_session_chat_event(
        driver,
        "session_clicked",
        payload={"session_id": existing_id},
    )
    final = _wait_for_state(driver, "session_active")

    ctx = final["context"]
    assert ctx.get("session_id") == existing_id, (
        f"US-206 #4: resumed session_id must equal the clicked id; "
        f"got {ctx.get('session_id')!r}, expected {existing_id!r}"
    )
    after = _list_sessions(proj_id)
    assert len(after) == len(before), (
        f"US-206 #4: clicking an existing session must NOT create a new row; "
        f"before={len(before)} after={len(after)}"
    )


@pytest.mark.error_path
def test_transient_create_session_failure_preserves_composer_text_across_retry(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """create_session 503 → error_recoverable; composer text "Show me top customers" preserved on retry."""
    proj_id = _create_project("Q4 Analytics")
    _spawn_j002_and_wait_session_list(driver)
    _send_session_chat_event(driver, "new_session_clicked")
    _wait_for_state(driver, "session_welcome")

    composer = "Show me top customers"
    # First attempt: forced transient failure (harness knob).
    _send_session_chat_event(
        driver,
        "first_message_sent",
        payload={"content": composer},
        extra_headers={"X-Force-Create-Session-Failure": "transient"},
    )
    failed = _wait_for_state(driver, "error_recoverable")
    fctx = failed["context"]
    assert fctx.get("pending_first_message") == composer, (
        f"US-206 #5: pending_first_message must be preserved on transient failure; "
        f"got {fctx.get('pending_first_message')!r}, expected {composer!r}"
    )
    assert fctx.get("underlying_cause_tag") == "transient", (
        f"US-206 #5: underlying_cause_tag must be 'transient'; got {fctx.get('underlying_cause_tag')!r}"
    )

    # Retry — flag is NOT set this time.
    _send_session_chat_event(driver, "retry_clicked")
    retry_state = _wait_for_state(driver, "session_welcome")
    rctx = retry_state["context"]
    assert rctx.get("pending_first_message") == composer, (
        f"US-206 #5: composer text must survive retry_clicked into session_welcome; "
        f"got {rctx.get('pending_first_message')!r}"
    )

    # Re-send the message — succeeds.
    _send_session_chat_event(
        driver,
        "first_message_sent",
        payload={"content": composer},
    )
    final = _wait_for_state(driver, "session_active")
    fctx = final["context"]
    assert isinstance(fctx.get("session_id"), str) and len(fctx["session_id"]) > 0, (
        f"US-206 #5: second attempt must create the session row; "
        f"got session_id={fctx.get('session_id')!r}"
    )
    after = _list_sessions(proj_id)
    assert len(after) == 1, f"US-206 #5: exactly one row must exist after retry; got {len(after)}"
    assert after[0]["title"] == composer[:80]


@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_drives_new_session_lifecycle_end_to_end(
    requires_compose_stack: None,
    requires_ts_harness: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """harness.j002.start_new_session + send_first_message; session title == first message."""
    proj_id = _create_project("Q4 Analytics")

    script = (
        "import { userFlowHarness } from './harness/user-flow-harness.ts';\n"
        "const h = userFlowHarness({\n"
        f"  authProxyUrl: '{driver.auth_proxy_url}',\n"
        "  fakeWorkOSUrl: 'http://localhost:14299',\n"
        f"  principalId: '{DEV_PRINCIPAL_ID}',\n"
        "});\n"
        "await h.j002.begin('Maya Chen');\n"
        "// Wait for session-chat to settle in session_list_loaded.\n"
        "for (let i = 0; i < 50; i++) {\n"
        "  const p = await h.j002.get_session_chat_projection();\n"
        "  if (p.state === 'session_list_loaded') break;\n"
        "  await new Promise(r => setTimeout(r, 100));\n"
        "}\n"
        "await h.j002.start_new_session();\n"
        "// session_welcome — session_id must be null.\n"
        "{\n"
        "  const p = await h.j002.get_session_chat_projection();\n"
        "  if (p.state !== 'session_welcome') throw new Error(`expected session_welcome, got ${p.state}`);\n"
        "  const ctx = p.context;\n"
        "  if (ctx.session_id != null) throw new Error(`session_id should be null pre-first-message; got ${ctx.session_id}`);\n"
        "}\n"
        "await h.j002.send_first_message('Show me top customers');\n"
        "// Wait for session_active.\n"
        "for (let i = 0; i < 50; i++) {\n"
        "  const p = await h.j002.get_session_chat_projection();\n"
        "  if (p.state === 'session_active') break;\n"
        "  await new Promise(r => setTimeout(r, 100));\n"
        "}\n"
        "const projection = await h.j002.get_session_chat_projection();\n"
        "if (projection.state !== 'session_active') throw new Error(`expected session_active; got ${projection.state}`);\n"
        "const sid = projection.context.session_id;\n"
        "if (typeof sid !== 'string' || sid.length === 0) throw new Error(`session_id missing post-first-message`);\n"
        "await h.j002.assert_session_active(sid);\n"
        "// Refresh the list and check the title.\n"
        "await h.j002.refresh_session_list();\n"
        "await new Promise(r => setTimeout(r, 200));\n"
        "const list = await h.j002.get_session_list();\n"
        "const row = list.find(r => r.id === sid);\n"
        "if (!row) throw new Error(`new session not in list: ${JSON.stringify(list)}`);\n"
        "if (row.title !== 'Show me top customers') throw new Error(`title mismatch: ${row.title}`);\n"
        "console.log(JSON.stringify({ok: true, session_id: sid, title: row.title}));\n"
    )
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=str(driver.repo_root / "tests" / "acceptance" / "user-flow-state-machines"),
        capture_output=True, text=True, timeout=30, check=False,
        env={"PATH": __import__("os").environ.get("PATH", "")},
    )
    assert result.returncode == 0, (
        f"harness.j002 new-session lifecycle failed (exit {result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    out = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "{}"
    body = json.loads(out)
    assert body.get("ok") is True
    assert isinstance(body.get("session_id"), str) and body["session_id"]
    assert body.get("title") == "Show me top customers"
    # Just to silence the unused-import lint — proj_id is in fact used by the
    # clean fixture indirectly.
    _ = proj_id
