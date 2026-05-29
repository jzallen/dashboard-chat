"""US-202 — Returning Maya lands in her last-used project on sign-in.

Gherkin SSOT: `docs/feature/project-and-chat-session-management/distill/features/us-202-returning-user-lands-in-last-used-project.feature`

DISTILL produces these tests RED. DELIVER's MR-1 un-skips them as the
resolver and loaders land.
"""

from __future__ import annotations

import pytest

from driver import J002Driver

pytestmark = [
    pytest.mark.real_io,
    pytest.mark.mr_1,
    pytest.mark.needs_compose_stack,
]


@pytest.mark.happy_path
def test_resolution_picks_project_carrying_most_recent_session(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Three projects; most-recent session is in Q4 Analytics → land there.

    Asserts: projection `state` = `project_selected`; `active_scope.project_id` =
    Q4 Analytics id; context.most_recent_session_per_project carries the
    timestamp map per OQ-J002-5 / DWD-9.
    """
    import json
    import subprocess
    import time

    DEV_PRINCIPAL_ID = "dev-user-001"
    J002_FLOW_ID = f"project-and-chat-session-management:{DEV_PRINCIPAL_ID}"

    # Seed three projects (dev backend). Project ids are server-assigned;
    # the resolver's tie-break is on project_id lexicographic, but the
    # happy-path tier-1 ordering is last_active_at desc, so we only need
    # most-recent-session-in-Q4. Project NAMES are chosen distinct.
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

    def _create_session(project_id: str, title: str) -> str:
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
        # The dev backend may return either {"data":{...}} (JSON:API) or
        # {"id":...} — tolerate both.
        if isinstance(body, dict) and "data" in body:
            return body["data"]["id"]
        return body["id"]

    q3_id = _create_project("Q3 Sales")
    time.sleep(0.05)
    q4_id = _create_project("Q4 Analytics")
    time.sleep(0.05)
    mk_id = _create_project("Marketing 2026")

    # Seed sessions so Q4 has the most-recent. We create a session in Q3
    # FIRST, then one in Marketing, then the LAST one in Q4 — so Q4's
    # last_active_at is the freshest.
    _create_session(q3_id, "Q3 chat 1")
    time.sleep(0.1)
    _create_session(mk_id, "Marketing chat")
    time.sleep(0.1)
    _create_session(q4_id, "Q4 latest chat")

    # Spawn J-002 → resolver picks Q4 (most-recent session).
    begin = driver.begin_session(
        force_restart=True,
        persona_display_name="Maya Chen",
        base=driver.auth_proxy_url,
    )
    assert begin.status == 200

    # Poll for project_selected.
    deadline = time.monotonic() + 5.0
    last_probe = None
    while time.monotonic() < deadline:
        probe = driver.get_j002_projection(
            flow_id=J002_FLOW_ID, base=driver.auth_proxy_url
        )
        last_probe = probe
        if driver.projection_state(probe) == "project_selected":
            break
        time.sleep(0.05)
    assert last_probe is not None
    assert driver.projection_state(last_probe) == "project_selected", (
        f"J-002 never reached project_selected; "
        f"final={driver.projection_state(last_probe)!r} "
        f"body={last_probe.body[:300]!r}"
    )

    body = json.loads(last_probe.body)
    selected_id = body["active_scope"]["project_id"]
    assert selected_id == q4_id, (
        f"US-202: resolver should pick Q4 (most-recent session) — "
        f"got project_id={selected_id!r} (expected {q4_id!r})"
    )
    # context.most_recent_session_per_project is populated by the resolver
    # with per-project last_active_at timestamps (OQ-J002-5).
    most_recent = body["regions"]["projectContext"]["context"].get("most_recent_session_per_project") or {}
    assert q4_id in most_recent, (
        f"context.most_recent_session_per_project must include Q4's id; "
        f"got keys={list(most_recent.keys())!r}"
    )


@pytest.mark.happy_path
def test_projects_with_no_sessions_fall_back_to_lexicographic_smallest_name(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Three projects, all empty → land in the lex-smallest by name.

    Asserts the project chip = "Marketing 2026"; session list is empty
    (no-sessions empty-state sub-shape).
    """
    import json
    import subprocess
    import time

    DEV_PRINCIPAL_ID = "dev-user-001"
    J002_FLOW_ID = f"project-and-chat-session-management:{DEV_PRINCIPAL_ID}"

    def _create_project(name: str) -> tuple[str, str]:
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
        return body["data"]["id"], name

    # Create THREE empty projects — no sessions seeded.
    p1_id, _ = _create_project("Q3 Sales")
    p2_id, _ = _create_project("Marketing 2026")
    p3_id, _ = _create_project("Q4 Analytics")

    # Spawn J-002 → resolver picks lex-smallest by NAME.
    begin = driver.begin_session(
        force_restart=True,
        persona_display_name="Maya Chen",
        base=driver.auth_proxy_url,
    )
    assert begin.status == 200

    deadline = time.monotonic() + 5.0
    last_probe = None
    while time.monotonic() < deadline:
        probe = driver.get_j002_projection(
            flow_id=J002_FLOW_ID, base=driver.auth_proxy_url
        )
        last_probe = probe
        if driver.projection_state(probe) == "project_selected":
            break
        time.sleep(0.05)
    assert last_probe is not None
    assert driver.projection_state(last_probe) == "project_selected"

    body = json.loads(last_probe.body)
    # Marketing 2026 is the lex-smallest name across {Q3 Sales, Marketing 2026, Q4 Analytics}.
    pc_context = body["regions"]["projectContext"]["context"]
    ctx_project = pc_context.get("project") or {}
    assert ctx_project.get("name") == "Marketing 2026", (
        f"US-202: lex-smallest by name fallback → expected 'Marketing 2026', "
        f"got {ctx_project.get('name')!r}"
    )
    # The selected id must be the Marketing project's id (proves the resolver
    # picked the right project, not just by alphabetic accident).
    assert ctx_project.get("id") == p2_id, (
        f"US-202: lex-smallest fallback should pick Marketing 2026's id "
        f"({p2_id!r}); got {ctx_project.get('id')!r}"
    )
    # No sessions across any project → most_recent_session_per_project is empty.
    most_recent = pc_context.get("most_recent_session_per_project") or {}
    assert most_recent == {}, (
        f"US-202: no-sessions case must have empty most_recent_session_per_project; "
        f"got {most_recent!r}"
    )
    # Sanity: all three projects exist.
    _ = (p1_id, p3_id)


@pytest.mark.boundary
@pytest.mark.property
def test_tie_broken_last_active_picks_lexicographic_smaller_project_id_deterministically(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Two projects with equal last_active_at → pick lexicographic-smaller id.

    Determinism assertion — repeated cold restarts produce identical results.
    """
    import json
    import subprocess
    import time

    DEV_PRINCIPAL_ID = "dev-user-001"
    J002_FLOW_ID = f"project-and-chat-session-management:{DEV_PRINCIPAL_ID}"

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
        return json.loads(proc.stdout)["data"]["id"]

    def _create_session(project_id: str, title: str) -> str:
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

    pa_id = _create_project("Project A")
    pb_id = _create_project("Project B")
    _create_session(pa_id, "Chat A")
    _create_session(pb_id, "Chat B")

    # Force equal last_active_at on both sessions (sqlite UPDATE via python).
    update_sql = (
        "import sqlite3; "
        "conn=sqlite3.connect('/data/app.db'); "
        "conn.execute(\"UPDATE sessions SET last_active_at = '2026-05-13T00:00:00'\"); "
        "conn.commit(); print('updated', conn.total_changes)"
    )
    proc = subprocess.run(
        ["docker", "exec", "dashboard-api", "python", "-c", update_sql],
        capture_output=True, text=True, timeout=10, check=True,
    )
    assert "updated" in proc.stdout

    # Determinism: spawn J-002 TWICE (force_restart per /begin), both must pick
    # the same project — the lex-smaller id.
    expected_pick = min(pa_id, pb_id)

    def _spawn_and_assert() -> str:
        begin = driver.begin_session(
            force_restart=True,
            persona_display_name="Maya Chen",
            base=driver.auth_proxy_url,
        )
        assert begin.status == 200
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            probe = driver.get_j002_projection(
                flow_id=J002_FLOW_ID, base=driver.auth_proxy_url
            )
            if driver.projection_state(probe) == "project_selected":
                return json.loads(probe.body)["active_scope"]["project_id"]
            time.sleep(0.05)
        pytest.fail("J-002 never reached project_selected")

    pick1 = _spawn_and_assert()
    pick2 = _spawn_and_assert()
    assert pick1 == expected_pick, (
        f"Tie-break: expected lex-smaller id {expected_pick!r}; "
        f"got {pick1!r} (other={max(pa_id, pb_id)!r})"
    )
    assert pick1 == pick2, (
        f"Tie-break must be deterministic across cold restarts; "
        f"got {pick1!r} then {pick2!r}"
    )


@pytest.mark.error_path
@pytest.mark.degraded
def test_transient_list_sessions_failure_during_last_used_resolution_emits_degraded_event(
    requires_compose_stack: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """Partial-result resolution: one project's list_sessions fails → fall back to remaining.

    Asserts: `last_used_resolution_degraded` is surfaced in projection context
    with the degraded project id; J-002 still reaches `project_selected` for
    the successful project within a generous local-stack budget.
    """
    import json
    import subprocess
    import time

    DEV_PRINCIPAL_ID = "dev-user-001"
    J002_FLOW_ID = f"project-and-chat-session-management:{DEV_PRINCIPAL_ID}"

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
        return json.loads(proc.stdout)["data"]["id"]

    def _create_session(project_id: str, title: str) -> str:
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

    q3_id = _create_project("Q3 Sales")
    q4_id = _create_project("Q4 Analytics")
    _create_session(q3_id, "Q3 chat")
    _create_session(q4_id, "Q4 chat")

    # Force Q4's list_sessions to fail → resolver should pick Q3 from the
    # partial-result set AND emit `last_used_resolution_degraded` carrying Q4's id.
    t0 = time.monotonic()
    begin = driver.post_state_event(
        event_type="session_begin",
        payload={"force_restart": True, "persona_display_name": "Maya Chen"},
        base=driver.auth_proxy_url,
        extra_headers={"X-Force-List-Sessions-Failure": q4_id},
    )
    assert begin.status == 200

    deadline = time.monotonic() + 5.0
    last_probe = None
    while time.monotonic() < deadline:
        probe = driver.get_j002_projection(
            flow_id=J002_FLOW_ID, base=driver.auth_proxy_url
        )
        last_probe = probe
        if driver.projection_state(probe) == "project_selected":
            break
        time.sleep(0.05)
    elapsed_ms = (time.monotonic() - t0) * 1000

    assert last_probe is not None
    assert driver.projection_state(last_probe) == "project_selected"

    body = json.loads(last_probe.body)
    # Resolver picked Q3 (the only project whose list_sessions succeeded).
    assert body["active_scope"]["project_id"] == q3_id, (
        f"degraded path: resolver should pick Q3 (the un-degraded project); "
        f"got {body['active_scope']['project_id']!r}"
    )
    # Projection context carries last_used_resolution_degraded with Q4's id.
    degraded = body["regions"]["projectContext"]["context"].get("last_used_resolution_degraded")
    assert degraded is not None, (
        f"degraded path: projection.context.last_used_resolution_degraded must "
        f"be populated; got {degraded!r}"
    )
    assert degraded.get("partial_result") is True
    assert q4_id in (degraded.get("failed_project_ids") or []), (
        f"degraded path: failed_project_ids must include {q4_id!r}; "
        f"got {degraded.get('failed_project_ids')!r}"
    )
    # Resolution time is well within a generous local-stack budget.
    assert elapsed_ms < 5000, f"degraded path elapsed={elapsed_ms:.0f}ms exceeds budget"


@pytest.mark.harness
@pytest.mark.needs_ts_harness
def test_ts_harness_asserts_initial_project_resolution(
    requires_compose_stack: None,
    requires_ts_harness: None,
    requires_node: None,
    clean_projects_for_dev_user: None,
    driver: J002Driver,
) -> None:
    """`harness.j002.assert_initial_project("Q4 Analytics")` reads from the projection.

    Drives the TS harness via node subprocess (REC-2 Option B — inline ESM
    snippet through driver.run_ts_harness). The snippet imports the harness's
    `j002` namespace, spawns J-002, and runs assert_initial_project against
    the seeded project name. A non-zero exit code surfaces the harness error.
    """
    import json
    import subprocess
    import time

    DEV_PRINCIPAL_ID = "dev-user-001"

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
        return json.loads(proc.stdout)["data"]["id"]

    def _create_session(project_id: str, title: str) -> str:
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

    # Seed: Q3 Sales + Q4 Analytics + Marketing 2026; Q4 has the most-recent session.
    q3 = _create_project("Q3 Sales")
    time.sleep(0.05)
    q4 = _create_project("Q4 Analytics")
    time.sleep(0.05)
    mk = _create_project("Marketing 2026")
    _create_session(q3, "Q3 chat")
    time.sleep(0.1)
    _create_session(mk, "Marketing chat")
    time.sleep(0.1)
    _create_session(q4, "Q4 latest chat")

    script = (
        "import { userFlowHarness } from './harness/user-flow-harness.ts';\n"
        "const h = userFlowHarness({\n"
        f"  authProxyUrl: 'http://localhost:1042',\n"
        f"  fakeWorkOSUrl: 'http://localhost:14299',\n"
        f"  principalId: '{DEV_PRINCIPAL_ID}',\n"
        "});\n"
        "await h.j002.begin('Maya Chen');\n"
        "await h.j002.assert_initial_project('Q4 Analytics');\n"
        "console.log(JSON.stringify({ok: true}));\n"
    )

    # node's --input-type=module needs tsx/node ESM TS support; the suite's
    # node_modules contains tsx — use `node --loader tsx`.
    result = subprocess.run(
        ["node", "--import", "tsx", "--input-type=module", "-e", script],
        cwd=str(driver.repo_root / "tests" / "acceptance" / "user-flow-state-machines"),
        capture_output=True, text=True, timeout=30, check=False,
        env={"PATH": __import__("os").environ.get("PATH", "")},
    )
    assert result.returncode == 0, (
        f"harness.j002.assert_initial_project failed (exit {result.returncode}):\n"
        f"stdout: {result.stdout}\nstderr: {result.stderr}"
    )
    out = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "{}"
    assert json.loads(out).get("ok") is True
