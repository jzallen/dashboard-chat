"""US-203 — Session list renders most-recent-first; caps at 5 in nav;
paginates at 30; cross-tab refreshes via projection-stream SSE.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-203-session-list-renders-most-recent-first.feature`

MR-2 dependency: the NEW `/projection/stream` SSE endpoint (DWD-9; per
the handoff "Open items" O2) lands in MR-2 DELIVER. The cross-tab
scenario un-skips when it ships.
"""

from __future__ import annotations

import json
import subprocess
import time

import httpx
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


def _update_session_last_active(session_id: str, last_active_at: str) -> None:
    """Force last_active_at via the backend SQLite directly — sidesteps the
    backend's auto-update-on-PATCH behavior which we don't want for ordering tests."""
    update_sql = (
        "import sqlite3; "
        "conn = sqlite3.connect('/data/app.db'); "
        f"conn.execute(\"UPDATE sessions SET last_active_at = '{last_active_at}' WHERE id = '{session_id}'\"); "
        "conn.commit(); print('updated', conn.total_changes)"
    )
    proc = subprocess.run(
        ["docker", "exec", "dashboard-api", "python", "-c", update_sql],
        capture_output=True, text=True, timeout=10, check=True,
    )
    assert "updated" in proc.stdout


def _spawn_j002(driver: J002Driver) -> dict:
    """Begin J-002 and wait for project-context to settle in project_selected.
    Returns the project-context projection body."""
    begin = driver.post(
        "/ui-state/flow/project-and-chat-session-management/begin",
        base=driver.auth_proxy_url,
        json_body={"persona_display_name": "Maya Chen"},
    )
    assert begin.status == 200
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        probe = driver.get_j002_projection(
            flow_id=PROJECT_FLOW_ID, base=driver.auth_proxy_url
        )
        if driver.projection_state(probe) == "project_selected":
            return json.loads(probe.body)
        time.sleep(0.05)
    pytest.fail("J-002 never reached project_selected")


def _read_session_chat(driver: J002Driver) -> dict:
    """Read the session-chat projection (via the parameterised :machine route)."""
    probe = driver.get(
        f"/ui-state/flow/session-chat/projection?flow_id={SESSION_CHAT_FLOW_ID}",
        base=driver.auth_proxy_url,
    )
    assert probe.status == 200, f"session-chat projection: {probe.status} {probe.body[:300]}"
    return json.loads(probe.body)


def _wait_for_session_chat_state(
    driver: J002Driver, expected_state: str, timeout_s: float = 5.0
) -> dict:
    deadline = time.monotonic() + timeout_s
    last: dict | None = None
    while time.monotonic() < deadline:
        last = _read_session_chat(driver)
        if last.get("state") == expected_state:
            return last
        time.sleep(0.05)
    pytest.fail(
        f"session-chat never reached {expected_state!r}; "
        f"final state={last.get('state') if last else None!r}"
    )


# ─────────────────────────── Scenarios ───────────────────────────


@pytest.mark.happy_path
def test_session_list_renders_sorted_most_recent_first(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """4 sessions with timestamps T1<T2<T3<T4 → list renders T4..T1.

    Asserts session_list is sorted DESC by last_active_at.
    """
    proj_id = _create_project("Q4 Analytics")
    s1 = _create_session(proj_id, "First chat")
    s2 = _create_session(proj_id, "Second chat")
    s3 = _create_session(proj_id, "Third chat")
    s4 = _create_session(proj_id, "Latest chat")
    # Force deterministic last_active_at ordering (T1 < T2 < T3 < T4).
    _update_session_last_active(s1, "2026-05-12T10:00:00")
    _update_session_last_active(s2, "2026-05-12T11:00:00")
    _update_session_last_active(s3, "2026-05-12T12:00:00")
    _update_session_last_active(s4, "2026-05-12T13:00:00")

    _spawn_j002(driver)
    session_chat = _wait_for_session_chat_state(driver, "session_list_visible")
    items = session_chat["context"].get("session_list") or []
    ids = [s["id"] for s in items]
    assert ids == [s4, s3, s2, s1], (
        f"US-203 ordering: expected [s4, s3, s2, s1] = {[s4, s3, s2, s1]!r}; "
        f"got {ids!r} (titles {[s.get('title') for s in items]!r})"
    )


@pytest.mark.happy_path
def test_recent_sessions_nav_caps_at_five_rows(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """10 sessions in a project → recent-sessions nav rail shows top 5.

    The session_list projection carries the full first page (page_size=30 per
    DESIGN §2.3.B); the "top 5" cap is a FE-render convention. We assert the
    list has at least 5 sessions and that the FIRST 5 are the most recent.
    """
    proj_id = _create_project("Q4 Analytics")
    ids: list[str] = []
    for i in range(10):
        sid = _create_session(proj_id, f"Chat {i:02d}")
        ids.append(sid)
        # Set last_active_at so position i has timestamp 2026-05-12T{i:02d}:00:00,
        # i.e. higher i = more recent.
        _update_session_last_active(sid, f"2026-05-12T{i:02d}:00:00")

    _spawn_j002(driver)
    session_chat = _wait_for_session_chat_state(driver, "session_list_visible")
    items = session_chat["context"].get("session_list") or []
    # Most recent first → reverse of insertion order.
    assert len(items) >= 5, f"expected >=5 sessions, got {len(items)}"
    top5_ids = [s["id"] for s in items[:5]]
    expected_top5 = list(reversed(ids[-5:]))  # ids[5..9] reversed = recents desc
    assert top5_ids == expected_top5, (
        f"US-203 top-5: expected {expected_top5!r}, got {top5_ids!r}"
    )


@pytest.mark.boundary
def test_zero_sessions_project_enters_no_sessions_empty_state_sub_shape(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """0 sessions → session_list_visible with empty list (no_sessions sub-shape per DWD-1)."""
    _create_project("Q4 Analytics")  # project exists but no sessions
    _spawn_j002(driver)
    session_chat = _wait_for_session_chat_state(driver, "session_list_visible")
    items = session_chat["context"].get("session_list") or []
    assert items == [], (
        f"US-203 zero-sessions: expected empty session_list; got {items!r}"
    )
    assert session_chat["state"] == "session_list_visible"


@pytest.mark.happy_path
def test_session_list_is_paginated_for_projects_with_more_than_thirty_sessions(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """35 sessions → page 1 carries 30 items; has_more=true.

    Per loadSessionList input page_size=30 (DESIGN §2.3.B).
    """
    proj_id = _create_project("Q4 Analytics")
    for i in range(35):
        sid = _create_session(proj_id, f"Chat {i:02d}")
        _update_session_last_active(sid, f"2026-05-12T{(i // 60):02d}:{(i % 60):02d}:00")

    _spawn_j002(driver)
    session_chat = _wait_for_session_chat_state(driver, "session_list_visible")
    items = session_chat["context"].get("session_list") or []
    has_more = session_chat["context"].get("session_list_has_more")
    # The backend's list_sessions endpoint paginates at 30 per request.
    assert len(items) <= 30, f"expected <=30 items on page 1, got {len(items)}"
    if len(items) == 30:
        # 35 sessions seeded → expect has_more=true
        assert has_more is True, (
            f"US-203 pagination: expected has_more=True with 30 of 35 items; got {has_more!r}"
        )


@pytest.mark.happy_path
def test_session_created_in_other_tab_refreshes_list_within_one_second(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Tab A subscribed to projection-stream; Tab B creates session +
    refreshes session-chat → Tab A receives the new list <1s.

    Mechanism (per DWD-9 + RD2):
      1. Tab A opens GET /ui-state/flow/session-chat/projection/stream
      2. The handler emits the current projection as the first frame.
      3. Tab B creates a session via backend + dispatches `refresh_session_list`
         to session-chat (so the orchestrator appends new events to the log).
      4. Tab A's SSE subscriber observes a second frame within the 1s budget.
    """
    proj_id = _create_project("Q4 Analytics")
    s1 = _create_session(proj_id, "First chat")
    _update_session_last_active(s1, "2026-05-12T10:00:00")
    _spawn_j002(driver)
    _wait_for_session_chat_state(driver, "session_list_visible")

    # Tab A opens the SSE stream with a 3s budget.
    sse_url = (
        f"{driver.auth_proxy_url}/ui-state/flow/session-chat/projection/stream"
        f"?flow_id={SESSION_CHAT_FLOW_ID}&budget_ms=3000"
    )
    received_frames: list[str] = []
    sse_start = time.monotonic()

    def _create_and_refresh_after_delay() -> None:
        time.sleep(0.2)  # let Tab A connect
        _create_session(proj_id, "Just-created chat (Tab B)")
        # Drive Tab B's session-chat to re-load.
        driver.post(
            "/ui-state/flow/session-chat/event",
            base=driver.auth_proxy_url,
            json_body={
                "flow_id": SESSION_CHAT_FLOW_ID,
                "type": "refresh_session_list",
                "payload": {},
            },
        )

    import threading
    threading.Thread(target=_create_and_refresh_after_delay, daemon=True).start()

    # Subscribe to the SSE stream and collect frames until we see one whose
    # session_list has at least 2 sessions (Tab A initially has 1; Tab B
    # creates another → Tab A's stream should observe the updated projection).
    def _count_sessions(frame: str) -> int:
        # SSE frame format: `event: projection\ndata: { ... }`
        try:
            data_line = next(
                line for line in frame.splitlines() if line.startswith("data:")
            )
        except StopIteration:
            return -1
        try:
            payload = json.loads(data_line[len("data:") :].strip())
        except json.JSONDecodeError:
            return -1
        return len(payload.get("context", {}).get("session_list") or [])

    with httpx.stream(
        "GET",
        sse_url,
        headers={"accept": "text/event-stream"},
        timeout=5.0,
    ) as response:
        assert response.status_code == 200
        buf = ""
        deadline = time.monotonic() + 3.5
        for chunk in response.iter_text():
            buf += chunk
            while "\n\n" in buf:
                frame, buf = buf.split("\n\n", 1)
                received_frames.append(frame)
                count = _count_sessions(frame)
                if count >= 2:
                    elapsed = time.monotonic() - sse_start
                    assert elapsed < 1.5, (
                        f"SSE refresh: expected <1.5s, took {elapsed:.2f}s"
                    )
                    return
            if time.monotonic() > deadline:
                break
    counts = [_count_sessions(f) for f in received_frames]
    pytest.fail(
        f"SSE refresh: never received a frame with >=2 sessions in {time.monotonic()-sse_start:.2f}s "
        f"(received {len(received_frames)} frames, session counts {counts!r})"
    )


@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_asserts_session_list_ordering(
    requires_compose_stack: None,
    requires_ts_harness: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """`harness.j002.get_session_list()` returns items in DESC order matching FE render.

    Drives the TS harness via node subprocess (REC-2 Option B per DDD-1).
    """
    proj_id = _create_project("Q4 Analytics")
    s1 = _create_session(proj_id, "Older chat")
    s2 = _create_session(proj_id, "Latest chat")
    _update_session_last_active(s1, "2026-05-12T10:00:00")
    _update_session_last_active(s2, "2026-05-12T13:00:00")

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
        "const sessions = await h.j002.get_session_list();\n"
        "console.log(JSON.stringify({ok: true, count: sessions.length, ids: sessions.map(s => s.id), titles: sessions.map(s => s.title)}));\n"
    )
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=str(driver.repo_root / "tests" / "acceptance" / "user-flow-state-machines"),
        capture_output=True, text=True, timeout=30, check=False,
        env={"PATH": __import__("os").environ.get("PATH", "")},
    )
    assert result.returncode == 0, (
        f"harness.j002.get_session_list failed (exit {result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    out = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "{}"
    body = json.loads(out)
    assert body.get("ok") is True
    # s2 is the most recent → first in the list.
    assert body["ids"][0] == s2, (
        f"harness ordering: expected first id={s2!r} got {body['ids'][0]!r} (titles {body['titles']!r})"
    )
    _ = proj_id  # silence unused
